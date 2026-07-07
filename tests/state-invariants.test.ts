import { describe, expect, it } from "vitest";
import { validateGoalStateInvariant } from "../src/state-invariants.js";
import type { GoalState } from "../src/types.js";

const goal: GoalState = {
	version: 1,
	revision: 1,
	goalId: "g1",
	objective: "ship",
	status: "active",
	acceptanceCriteria: [],
	sourcePaths: [],
	progress: { done: [], blocked: [], summary: "" },
	createdAt: 1,
	updatedAt: 1,
	runStartedAt: 1,
	evaluationTurns: 0,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	lastEvaluationReason: "Goal started.",
};

describe("validateGoalStateInvariant", () => {
	it("accepts a valid active goal", () => {
		expect(validateGoalStateInvariant(goal)).toEqual({ ok: true });
	});

	it("rejects missing goal ids", () => {
		expect(validateGoalStateInvariant({ ...goal, goalId: " " })).toEqual({
			ok: false,
			reason: "Goal state invariant failed: goalId is required.",
		});
	});

	it("rejects negative evaluator turns and total usage", () => {
		expect(
			validateGoalStateInvariant({ ...goal, evaluationTurns: -1 }).ok,
		).toBe(false);
		expect(
			validateGoalStateInvariant({
				...goal,
				usage: { ...goal.usage, total: -1 },
			}).ok,
		).toBe(false);
	});

	it("rejects terminal or paused goals with pending continuation", () => {
		expect(
			validateGoalStateInvariant({
				...goal,
				status: "complete",
				continuationPendingAt: 2,
			}).ok,
		).toBe(false);
		expect(
			validateGoalStateInvariant({
				...goal,
				status: "paused",
				continuationPendingAt: 2,
			}).ok,
		).toBe(false);
	});

	it("rejects completed goals with blockers", () => {
		expect(
			validateGoalStateInvariant({
				...goal,
				status: "complete",
				progress: { ...goal.progress, blocked: ["waiting"] },
			}),
		).toEqual({
			ok: false,
			reason:
				"Goal state invariant failed: complete goals cannot have blockers.",
		});
	});
});
