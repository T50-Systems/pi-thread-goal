import { describe, expect, it } from "vitest";
import {
	renderGoalContext,
	renderGoalContinuationPrompt,
	renderGoalEvaluationPrompt,
	renderGoalStartPrompt,
} from "../src/prompts.js";
import type { GoalState } from "../src/types.js";

const batchGoal: GoalState = {
	version: 1,
	revision: 1,
	goalId: "g1",
	objective: "Trabaja uno a uno todos los issues abiertos hasta terminarlos",
	status: "active",
	acceptanceCriteria: [],
	sourcePaths: [],
	progress: {
		done: ["issue 330"],
		current: "issue 333",
		blocked: [],
		summary: "Issue 330 terminado",
	},
	createdAt: 1,
	updatedAt: 1,
	runStartedAt: 1,
	evaluationTurns: 0,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	lastEvaluationReason: "Need more work.",
};

describe("goal prompts", () => {
	it("tells agents not to stop after one batch item or checkpoint", () => {
		const context = renderGoalContext(batchGoal);
		const start = renderGoalStartPrompt(batchGoal);
		const continuation = renderGoalContinuationPrompt(
			batchGoal,
			"issue 330 completed",
		);

		expect(context).toContain("finishing one item is progress only");
		expect(context).toContain("Before any user-facing status/final response");
		expect(context).toContain("do not answer with a checkpoint");
		expect(start).toContain("do not stop after reporting one finished item");
		expect(start).toContain(
			"A status summary/checkpoint is not a valid stopping point",
		);
		expect(continuation).toContain("invalid checkpoint stop");
		expect(continuation).toContain("choose the next unfinished item");
	});

	it("tells the evaluator that one completed issue is not enough for a batch goal", () => {
		const prompt = renderGoalEvaluationPrompt(batchGoal);

		expect(prompt).toContain("completion of one item/subtask is not enough");
		expect(prompt).toContain("checkpoint summary");
		expect(prompt).toContain("one completed coherent sub-block");
	});

	it("distinguishes real blockers from risks and actionable uncertainty", () => {
		expect(renderGoalContext(batchGoal)).toContain(
			"Do not record technical risk, uncertainty, or difficult-but-actionable work as Blocked",
		);
		expect(renderGoalEvaluationPrompt(batchGoal)).toContain(
			"technical risk, uncertainty, or hard-but-actionable work is not an operational blocker",
		);
		expect(renderGoalContinuationPrompt(batchGoal, "risk remains")).toContain(
			"Treat technical risk, uncertainty, or difficult-but-actionable work as progress/current context rather than Blocked",
		);
	});
});
