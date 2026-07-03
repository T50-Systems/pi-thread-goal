import type { GoalEvent, GoalProgress, GoalState } from "./types.js";

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

export function reduceGoalState(
	current: GoalState | null,
	event: GoalEvent,
): GoalState | null {
	switch (event.action) {
		case "create":
			return current ?? createGoalState(event);
		case "replace":
			return createGoalState(event);
		case "edit": {
			if (!isCurrentGoal(current, event.goalId)) return current;
			return {
				...current,
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
			if (!isCurrentGoal(current, event.goalId) || current.status !== "active")
				return current;
			return {
				...current,
				status: "paused",
				updatedAt: event.now,
				pauseReason: event.reason ?? "manual",
				pauseMessage: normalizeText(event.message),
				continuationPendingAt: undefined,
				continuationReason: undefined,
			};
		case "resume":
			if (!isCurrentGoal(current, event.goalId) || current.status !== "paused")
				return current;
			return {
				...current,
				status: "active",
				updatedAt: event.now,
				runStartedAt: event.now,
				evaluationTurns: 0,
				usage: emptyUsage(),
				pauseReason: undefined,
				pauseMessage: undefined,
				lastEvaluationReason: "Goal resumed.",
			};
		case "clear":
			return isCurrentGoal(current, event.goalId) ? null : current;
		case "complete":
			if (!isCurrentGoal(current, event.goalId) || current.status !== "active")
				return current;
			return {
				...current,
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
			};
		case "dismiss":
			if (!isCurrentGoal(current, event.goalId)) return current;
			return { ...current, updatedAt: event.now, dismissedAt: event.now };
		case "progress":
			if (!isCurrentGoal(current, event.goalId) || current.status !== "active")
				return current;
			return {
				...current,
				updatedAt: event.now,
				progress: normalizeProgress(event.progress, current.progress),
			};
		case "evaluation":
			if (!isCurrentGoal(current, event.goalId) || current.status !== "active")
				return current;
			return {
				...current,
				updatedAt: event.now,
				evaluationTurns: current.evaluationTurns + 1,
				lastEvaluationReason:
					event.reason.trim() || current.lastEvaluationReason,
				usage: mergeUsage(current.usage, event.usage),
			};
		case "continuation":
			if (!isCurrentGoal(current, event.goalId) || current.status !== "active")
				return current;
			return event.pending
				? {
						...current,
						updatedAt: event.now,
						continuationPendingAt: event.now,
						continuationReason: normalizeText(event.reason),
					}
				: {
						...current,
						updatedAt: event.now,
						continuationPendingAt: undefined,
						continuationReason: undefined,
					};
		default:
			return current;
	}
}

function isCurrentGoal(
	current: GoalState | null,
	goalId: string,
): current is GoalState {
	return current !== null && current.goalId === goalId;
}

function normalizeProgress(
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

function normalizeList(values: readonly string[] | undefined): string[] {
	if (!values) return [];
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeTokenBudget(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: undefined;
}

function normalizeText(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function emptyUsage() {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function mergeUsage(
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
