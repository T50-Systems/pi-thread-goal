import { describe, expect, it } from "vitest";
import {
	buildContinuationReason,
	classifyProgressBlocker,
	decideGoalNextAction,
	hasOnlyNonOperationalBlockers,
	hasReachedAutomaticContinuationLimit,
	hasReachedTokenBudget,
	isCheckpointOnlyStop,
	MAX_AUTOMATIC_CONTINUATION_TURNS,
} from "../src/policies.js";
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

describe("hasReachedAutomaticContinuationLimit", () => {
	it("stops automatic continuation once the evaluator turn cap is reached", () => {
		expect(
			hasReachedAutomaticContinuationLimit({
				...goal,
				evaluationTurns: MAX_AUTOMATIC_CONTINUATION_TURNS - 1,
			}),
		).toBe(false);

		expect(
			hasReachedAutomaticContinuationLimit({
				...goal,
				evaluationTurns: MAX_AUTOMATIC_CONTINUATION_TURNS,
			}),
		).toBe(true);
	});

	it("does not apply to paused goals", () => {
		expect(
			hasReachedAutomaticContinuationLimit({
				...goal,
				status: "paused",
				evaluationTurns: MAX_AUTOMATIC_CONTINUATION_TURNS,
			}),
		).toBe(false);
	});
});

describe("hasReachedTokenBudget", () => {
	it("stops active goals once token usage reaches the configured budget", () => {
		expect(
			hasReachedTokenBudget({
				...goal,
				tokenBudget: 100,
				usage: { ...goal.usage, total: 99 },
			}),
		).toBe(false);
		expect(
			hasReachedTokenBudget({
				...goal,
				tokenBudget: 100,
				usage: { ...goal.usage, total: 100 },
			}),
		).toBe(true);
		expect(
			hasReachedTokenBudget({
				...goal,
				status: "paused",
				tokenBudget: 100,
				usage: { ...goal.usage, total: 100 },
			}),
		).toBe(false);
	});
});

describe("checkpoint and blocker continuation policy", () => {
	it("detects checkpoint-only status reports for unmet batch goals", () => {
		expect(
			isCheckpointOnlyStop(
				"Sub-bloque terminado, tests OK. No marqué el goal como completo porque quedan pendientes del roadmap.",
			),
		).toBe(true);
		expect(
			isCheckpointOnlyStop("I need a user decision before continuing."),
		).toBe(false);
	});

	it("strengthens continuation reasons for checkpoint-only unmet turns", () => {
		expect(
			buildContinuationReason(
				goal,
				{ met: false, reason: "Roadmap remains." },
				"Build passed; no marqué el goal como completo porque aún quedan pendientes.",
			),
		).toContain("Previous turn was checkpoint-only while goal remains unmet");
	});

	it("classifies technical risk separately from operational blockers", () => {
		expect(
			classifyProgressBlocker(
				"Full complex-script/ZWJ shaping likely needs HarfBuzz",
			),
		).toBe("risk");
		expect(
			classifyProgressBlocker(
				"waiting for user decision on shaping engine dependency",
			),
		).toBe("operational");
		expect(
			hasOnlyNonOperationalBlockers([
				"Full complex-script/ZWJ shaping likely needs HarfBuzz",
			]),
		).toBe(true);
	});
});

describe("decideGoalNextAction", () => {
	it("completes when evaluator says met and completion validation allows it", () => {
		expect(decideGoalNextAction(goal, { met: true, reason: "done" })).toEqual({
			type: "complete",
			reason: "done",
		});
	});

	it("continues instead of completing when current work is still pending", () => {
		expect(
			decideGoalNextAction(
				{ ...goal, progress: { ...goal.progress, current: "implement tests" } },
				{ met: true, reason: "done" },
			),
		).toEqual({
			type: "continue",
			reason:
				"Current work still appears pending: implement tests. Update progress before completing.",
		});
	});

	it("continues instead of completing when blockers remain", () => {
		expect(
			decideGoalNextAction(
				{
					...goal,
					progress: { ...goal.progress, blocked: ["waiting on tests"] },
				},
				{ met: true, reason: "tests passed" },
			),
		).toEqual({
			type: "continue",
			reason:
				"Cannot complete goal with unresolved blockers: waiting on tests.",
		});
	});

	it("continues instead of completing when acceptance evidence is not completion-like", () => {
		expect(
			decideGoalNextAction(
				{ ...goal, acceptanceCriteria: ["tests pass"] },
				{ met: true, reason: "looked at branch" },
			),
		).toEqual({
			type: "continue",
			reason:
				"Completion evidence must cite satisfied criteria, tests, validation, or delivered work.",
		});
	});

	it("completes only when evaluator says met and completion evidence is valid", () => {
		expect(
			decideGoalNextAction(
				{ ...goal, acceptanceCriteria: ["tests pass"] },
				{ met: true, reason: "tests passed and criteria completed" },
			),
		).toEqual({
			type: "complete",
			reason: "tests passed and criteria completed",
		});
	});

	it("pauses for evaluator configuration failures", () => {
		expect(
			decideGoalNextAction(goal, {
				met: false,
				reason: "No evaluator API key available for the selected provider.",
			}),
		).toEqual({
			type: "pause-error",
			reason: "No evaluator API key available for the selected provider.",
		});
	});

	it("pauses for token budget before continuing", () => {
		expect(
			decideGoalNextAction(
				{ ...goal, tokenBudget: 100, usage: { ...goal.usage, total: 100 } },
				{ met: false, reason: "more" },
			),
		).toEqual({
			type: "pause-token-budget",
			reason: "Token budget reached (100/100).",
		});
	});

	it("pauses for automatic turn limit before continuing", () => {
		expect(
			decideGoalNextAction(
				{ ...goal, evaluationTurns: MAX_AUTOMATIC_CONTINUATION_TURNS },
				{ met: false, reason: "more" },
			),
		).toEqual({
			type: "pause-turn-limit",
			reason: `Paused after ${MAX_AUTOMATIC_CONTINUATION_TURNS} evaluator turns without completion.`,
		});
	});
});
