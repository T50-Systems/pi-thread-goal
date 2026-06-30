import { describe, expect, it, vi } from "vitest";
import { applyGoalUi } from "../src/ui.js";
import type { GoalState } from "../src/types.js";

const baseGoal: GoalState = {
  version: 1,
  goalId: "g1",
  objective: "ship",
  status: "active",
  acceptanceCriteria: [],
  sourcePaths: [],
  progress: { done: [], blocked: [], summary: "working" },
  createdAt: 1,
  updatedAt: 1,
  runStartedAt: 1,
  evaluationTurns: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  lastEvaluationReason: "working",
};

describe("applyGoalUi", () => {
  it("hides the widget when goal is complete", () => {
    const setStatus = vi.fn();
    const setWidget = vi.fn();
    applyGoalUi(
      { ui: { setStatus, setWidget } },
      { ...baseGoal, status: "complete" },
    );
    expect(setStatus).toHaveBeenCalledWith("goal", expect.stringContaining("/goal complete"));
    expect(setWidget).toHaveBeenCalledWith("goal", undefined);
  });
});
