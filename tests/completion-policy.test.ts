import { describe, expect, it } from "vitest";
import { validateGoalCompletion } from "../src/policies.js";
import type { GoalState } from "../src/types.js";

const baseGoal: GoalState = {
	version: 1,
	revision: 1,
	goalId: "g1",
	objective: "ship the feature",
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

describe("validateGoalCompletion", () => {
	it("rejects non-active goals", () => {
		expect(
			validateGoalCompletion({ ...baseGoal, status: "paused" }, "tests passed"),
		).toEqual({
			ok: false,
			reason: "Goal is not active; current status is paused.",
		});
	});

	it("rejects unresolved blockers before evaluating evidence", () => {
		expect(
			validateGoalCompletion(
				{
					...baseGoal,
					acceptanceCriteria: ["tests pass"],
					progress: { done: [], blocked: ["waiting on review"], summary: "" },
				},
				"tests passed",
			),
		).toEqual({
			ok: false,
			reason:
				"Cannot complete goal with unresolved blockers: waiting on review.",
		});
	});

	it("requires evidence when acceptance criteria exist", () => {
		expect(
			validateGoalCompletion(
				{ ...baseGoal, acceptanceCriteria: ["tests pass"] },
				" ",
			),
		).toEqual({
			ok: false,
			reason: "Completion evidence is required.",
		});
	});

	it("requires evidence even without acceptance criteria", () => {
		expect(validateGoalCompletion(baseGoal, " ")).toEqual({
			ok: false,
			reason: "Completion evidence is required.",
		});
	});

	it("requires completion-like evidence, not arbitrary text", () => {
		expect(
			validateGoalCompletion(
				{ ...baseGoal, acceptanceCriteria: ["tests pass"] },
				"looked at the branch",
			),
		).toEqual({
			ok: false,
			reason:
				"Completion evidence must cite satisfied criteria, tests, validation, or delivered work.",
		});
	});

	it("rejects pending current work unless done progress mentions it", () => {
		expect(
			validateGoalCompletion(
				{
					...baseGoal,
					progress: {
						done: [],
						blocked: [],
						summary: "",
						current: "write docs",
					},
				},
				"done",
			),
		).toEqual({
			ok: false,
			reason:
				"Current work still appears pending: write docs. Update progress before completing.",
		});
	});

	it("allows completion when pending current work is reflected in done progress", () => {
		expect(
			validateGoalCompletion(
				{
					...baseGoal,
					acceptanceCriteria: ["docs updated"],
					progress: {
						done: ["write docs"],
						blocked: [],
						summary: "docs updated",
						current: "write docs",
					},
				},
				"tests passed and criteria completed",
			),
		).toEqual({ ok: true });
	});
});
