import type { GoalEvent, GoalState } from "./types.js";
import {
	createGoalState,
	emptyUsage,
	mergeUsage,
	normalizeList,
	normalizeProgress,
	normalizeText,
	normalizeTokenBudget,
	validateObjective,
} from "./goal-state-normalizers.js";
import {
	decideGoalTransition,
	resolveTransitionIntent,
	type GoalTransitionIntent,
} from "./goal-transition-policy.js";

export {
	createGoalState,
	GoalStateValidationError,
	MAX_OBJECTIVE_LENGTH,
	validateObjective,
} from "./goal-state-normalizers.js";
export {
	canAutoResumeGoal,
	canQueueGoalContinuation,
	decideGoalTransition,
	isGoalActive,
	isGoalPaused,
	type ActiveGoalState,
	type GoalTransitionDecision,
	type GoalTransitionIntent,
	type PausedGoalState,
} from "./goal-transition-policy.js";

export function reduceGoalStateMachine(
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
