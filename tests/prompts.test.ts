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
  goalId: "g1",
  objective: "Trabaja uno a uno todos los issues abiertos hasta terminarlos",
  status: "active",
  acceptanceCriteria: [],
  sourcePaths: [],
  progress: { done: ["issue 330"], current: "issue 333", blocked: [], summary: "Issue 330 terminado" },
  createdAt: 1,
  updatedAt: 1,
  runStartedAt: 1,
  evaluationTurns: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  lastEvaluationReason: "Need more work.",
};

describe("goal prompts", () => {
  it("tells agents not to stop after one batch item", () => {
    expect(renderGoalContext(batchGoal)).toContain("finishing one item is progress only");
    expect(renderGoalStartPrompt(batchGoal)).toContain("do not stop after reporting one finished item");
    expect(renderGoalContinuationPrompt(batchGoal, "issue 330 completed")).toContain("choose the next unfinished item");
  });

  it("tells the evaluator that one completed issue is not enough for a batch goal", () => {
    const prompt = renderGoalEvaluationPrompt(batchGoal);

    expect(prompt).toContain("completion of one item/subtask is not enough");
    expect(prompt).toContain("intermediate status report");
  });
});
