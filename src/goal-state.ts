import type {
	GoalEvent,
	GoalEventMetadata,
	GoalProgress,
	GoalState,
} from "./types.js";

export const MAX_OBJECTIVE_LENGTH = 4000;

// ast-grep-ignore large-class
export class GoalStateValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GoalStateValidationError";
	}
}

export function validateObjective(objective: string): string {
	const trimmed = objective.trim();
	if (trimmed.length === 0) {
		throw new GoalStateValidationError("Goal objective must be non-empty.");
	}
	if (trimmed.length > MAX_OBJECTIVE_LENGTH) {
		throw new GoalStateValidationError(
			`Goal objective must be ${MAX_OBJECTIVE_LENGTH} characters or fewer.`,
		);
	}
	return trimmed;
}

export function createGoalState(
	event: Extract<GoalEvent, { action: "create" | "replace" }>,
): GoalState {
	return {
		version: 1,
		revision: 1,
		goalId: event.goalId,
		objective: validateObjective(event.objective),
		status: "active",
		acceptanceCriteria: normalizeList(event.acceptanceCriteria),
		sourcePaths: normalizeList(event.sourcePaths),
		tokenBudget: normalizeTokenBudget(event.tokenBudget),
		progress: normalizeProgress(),
		createdAt: event.now,
		updatedAt: event.now,
		runStartedAt: event.now,
		evaluationTurns: 0,
		usage: emptyUsage(),
		lastEvaluationReason: "Goal started.",
	};
}

export function normalizeProgress(
	progress: Partial<GoalProgress> = {},
	base?: GoalProgress,
): GoalProgress {
	return {
		done: normalizeList(progress.done ?? base?.done),
		current: normalizeText(progress.current ?? base?.current),
		blocked: normalizeList(progress.blocked ?? base?.blocked),
		summary: normalizeText(progress.summary ?? base?.summary) ?? "",
	};
}

export function normalizeList(values: readonly string[] | undefined): string[] {
	if (!values) return [];
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeTokenBudget(
	value: number | undefined,
): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: undefined;
}

export function normalizeText(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function emptyUsage() {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

export function mergeUsage(
	current: GoalState["usage"],
	delta: Partial<GoalState["usage"]> | undefined,
) {
	return {
		input: current.input + Math.max(0, delta?.input ?? 0),
		output: current.output + Math.max(0, delta?.output ?? 0),
		cacheRead: current.cacheRead + Math.max(0, delta?.cacheRead ?? 0),
		cacheWrite: current.cacheWrite + Math.max(0, delta?.cacheWrite ?? 0),
		total: current.total + Math.max(0, delta?.total ?? 0),
	};
}

export interface GoalTransitionDecision {
	allowed: boolean;
	reason?: string;
}

export type GoalTransitionIntent = GoalEventMetadata;
export type ActiveGoalState = GoalState & { status: "active" };
export type PausedGoalState = GoalState & { status: "paused" };

export function decideGoalTransition(
	current: GoalState | null,
	event: GoalEvent,
	intent: GoalTransitionIntent = {},
): GoalTransitionDecision {
	const resolvedIntent = resolveTransitionIntent(event, intent);

	if (event.action === "create") {
		return current === null
			? allow()
			: reject("A goal already exists; create requires an empty goal slot.");
	}

	if (event.action === "replace") return allow();

	if (!isCurrentGoal(current, event.goalId)) {
		return reject("Event does not target the current goal.");
	}

	switch (event.action) {
		case "edit":
			return current.status === "complete"
				? reject("Completed goals cannot be edited.")
				: allow();
		case "pause":
			return current.status === "active"
				? allow()
				: reject("Only active goals can be paused.");
		case "resume":
			if (current.status !== "paused") {
				return reject("Only paused goals can be resumed.");
			}
			if (resolvedIntent.source === undefined) return allowLegacyReplay();
			return resolvedIntent.source === "user-command" &&
				resolvedIntent.explicitUserIntent === true
				? allow()
				: reject("Paused goals require explicit user resume intent.");
		case "clear":
		case "dismiss":
			return allow();
		case "complete":
		case "progress":
		case "evaluation":
		case "continuation":
			return current.status === "active"
				? allow()
				: reject(`${event.action} requires an active goal.`);
		default:
			return reject("Unknown goal event action.");
	}
}

export function canQueueGoalContinuation(
	goal: GoalState | null,
): goal is ActiveGoalState {
	return isGoalActive(goal);
}

export function canAutoResumeGoal(
	goal: GoalState | null,
): goal is ActiveGoalState {
	return isGoalActive(goal);
}

export function isGoalActive(goal: GoalState | null): goal is ActiveGoalState {
	return goal !== null && goal.status === "active";
}

export function isGoalPaused(goal: GoalState | null): goal is PausedGoalState {
	return goal !== null && goal.status === "paused";
}

export function resolveTransitionIntent(
	event: GoalEvent,
	intent: GoalTransitionIntent,
): GoalTransitionIntent {
	return {
		...intent,
		source: intent.source ?? event.source,
		explicitUserIntent: intent.explicitUserIntent ?? event.explicitUserIntent,
		causedBy: intent.causedBy ?? event.causedBy,
	};
}

function isCurrentGoal(
	current: GoalState | null,
	goalId: string,
): current is GoalState {
	return current !== null && current.goalId === goalId;
}

function allow(): GoalTransitionDecision {
	return { allowed: true };
}

function allowLegacyReplay(): GoalTransitionDecision {
	return { allowed: true, reason: "Allowed for legacy event replay." };
}

function reject(reason: string): GoalTransitionDecision {
	return { allowed: false, reason };
}

export type GoalStateInvariantResult =
	| { ok: true }
	| { ok: false; reason: string };

export function validateGoalStateInvariant(
	goal: GoalState,
): GoalStateInvariantResult {
	if (goal.goalId.trim().length === 0) {
		return {
			ok: false,
			reason: "Goal state invariant failed: goalId is required.",
		};
	}
	if (!Number.isInteger(goal.revision) || goal.revision < 1) {
		return {
			ok: false,
			reason:
				"Goal state invariant failed: revision must be a positive integer.",
		};
	}
	if (!Number.isInteger(goal.evaluationTurns) || goal.evaluationTurns < 0) {
		return {
			ok: false,
			reason:
				"Goal state invariant failed: evaluationTurns must be non-negative.",
		};
	}
	if (!Number.isFinite(goal.usage.total) || goal.usage.total < 0) {
		return {
			ok: false,
			reason: "Goal state invariant failed: usage.total must be non-negative.",
		};
	}
	if (goal.status === "complete" && goal.continuationPendingAt !== undefined) {
		return {
			ok: false,
			reason:
				"Goal state invariant failed: complete goals cannot have pending continuation.",
		};
	}
	if (goal.status === "paused" && goal.continuationPendingAt !== undefined) {
		return {
			ok: false,
			reason:
				"Goal state invariant failed: paused goals cannot have pending continuation.",
		};
	}
	if (goal.status === "complete" && goal.progress.blocked.length > 0) {
		return {
			ok: false,
			reason:
				"Goal state invariant failed: complete goals cannot have blockers.",
		};
	}
	return { ok: true };
}

export function reduceGoalState(
	current: GoalState | null,
	event: GoalEvent,
	intent: GoalTransitionIntent = {},
): GoalState | null {
	const resolvedIntent = resolveTransitionIntent(event, intent);
	const decision = decideGoalTransition(current, event, resolvedIntent);
	if (!decision.allowed) return current;

	switch (event.action) {
		case "create":
			return current ?? createGoalState(event);
		case "replace":
			return createGoalState(event);
		case "edit": {
			if (!current) return current;
			return {
				...current,
				revision: nextRevision(current),
				objective:
					event.objective === undefined
						? current.objective
						: validateObjective(event.objective),
				acceptanceCriteria:
					event.acceptanceCriteria === undefined
						? current.acceptanceCriteria
						: normalizeList(event.acceptanceCriteria),
				sourcePaths:
					event.sourcePaths === undefined
						? current.sourcePaths
						: normalizeList(event.sourcePaths),
				tokenBudget:
					event.tokenBudget === undefined
						? current.tokenBudget
						: normalizeTokenBudget(event.tokenBudget),
				updatedAt: event.now,
			};
		}
		case "pause":
			if (!current) return current;
			return {
				...current,
				revision: nextRevision(current),
				status: "paused",
				updatedAt: event.now,
				pauseReason: event.reason ?? "manual",
				pauseMessage: normalizeText(event.message),
				continuationPendingAt: undefined,
				continuationReason: undefined,
				continuationPhase: "cleared",
			};
		case "resume":
			if (!current) return current;
			return {
				...current,
				revision: nextRevision(current),
				status: "active",
				updatedAt: event.now,
				runStartedAt: event.now,
				evaluationTurns: 0,
				usage: emptyUsage(),
				pauseReason: undefined,
				pauseMessage: undefined,
				lastEvaluationReason: "Goal resumed.",
				continuationPendingAt: undefined,
				continuationReason: undefined,
				continuationPhase: undefined,
				continuationAttempt: undefined,
				continuationFailures: undefined,
				continuationLastError: undefined,
				continuationLastMode: undefined,
				continuationLastSentAt: undefined,
				continuationLastStartedAt: undefined,
			};
		case "clear":
			return null;
		case "complete":
			if (!current) return current;
			return {
				...current,
				revision: nextRevision(current),
				status: "complete",
				updatedAt: event.now,
				completedAt: event.now,
				lastEvaluationReason:
					event.evidence?.trim() ||
					current.lastEvaluationReason ||
					"Goal completed.",
				progress: {
					...current.progress,
					summary:
						event.evidence?.trim() ||
						current.progress.summary ||
						"Goal completed.",
					blocked: [],
				},
				continuationPendingAt: undefined,
				continuationReason: undefined,
				continuationPhase: "cleared",
			};
		case "dismiss":
			return current
				? {
						...current,
						revision: nextRevision(current),
						updatedAt: event.now,
						dismissedAt: event.now,
					}
				: current;
		case "progress":
			return current
				? {
						...current,
						revision: nextRevision(current),
						updatedAt: event.now,
						progress: normalizeProgress(event.progress, current.progress),
					}
				: current;
		case "evaluation":
			return current
				? {
						...current,
						revision: nextRevision(current),
						updatedAt: event.now,
						evaluationTurns: current.evaluationTurns + 1,
						lastEvaluationReason:
							event.reason.trim() || current.lastEvaluationReason,
						usage: mergeUsage(current.usage, event.usage),
					}
				: current;
		case "continuation":
			if (!current) return current;
			return reduceContinuationState(current, event);
		default:
			return current;
	}
}

function reduceContinuationState(
	current: GoalState,
	event: Extract<GoalEvent, { action: "continuation" }>,
): GoalState {
	const phase = event.phase ?? (event.pending ? "queued" : "cleared");
	const reason = normalizeText(event.reason) ?? current.continuationReason;
	const error = normalizeText(event.error);
	const startsAttempt =
		event.pending && (phase === "queued" || phase === "stale-retry");
	const clearsLastError =
		phase === "queued" || phase === "stale-retry" || phase === "sent";
	const continuationAttempt = startsAttempt
		? (current.continuationAttempt ?? 0) + 1
		: current.continuationAttempt;
	const continuationFailures =
		phase === "failed"
			? (current.continuationFailures ?? 0) + 1
			: current.continuationFailures;

	if (!event.pending) {
		return {
			...current,
			revision: nextRevision(current),
			updatedAt: event.now,
			continuationPendingAt: undefined,
			continuationReason: undefined,
			continuationPhase: phase,
			continuationLastError: error ?? current.continuationLastError,
			continuationLastStartedAt:
				phase === "started" ? event.now : current.continuationLastStartedAt,
		};
	}

	return {
		...current,
		revision: nextRevision(current),
		updatedAt: event.now,
		continuationPendingAt: event.now,
		continuationReason: reason,
		continuationPhase: phase,
		continuationAttempt,
		continuationFailures,
		continuationLastError:
			error ?? (clearsLastError ? undefined : current.continuationLastError),
		continuationLastMode: event.mode ?? current.continuationLastMode,
		continuationLastSentAt:
			phase === "sent" ? event.now : current.continuationLastSentAt,
	};
}

function nextRevision(current: GoalState): number {
	return current.revision + 1;
}
