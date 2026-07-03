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
