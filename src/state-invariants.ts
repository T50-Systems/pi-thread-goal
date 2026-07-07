import type { GoalState } from "./types.js";

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
