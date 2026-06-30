import { describe, expect, it } from "vitest";
import { createGoalStateSnapshot, reduceGoalState } from "../src/state.js";
import type { GoalEvent } from "../src/types.js";

function apply(events: GoalEvent[]) {
  let state = null;
  for (const event of events) {
    state = reduceGoalState(state, event);
  }
  return state;
}

describe("goal state", () => {
  it("creates, progresses, pauses, resumes, and completes", () => {
    const state = apply([
      { action: "create", goalId: "g1", objective: "ship it", now: 1 },
      { action: "progress", goalId: "g1", now: 2, progress: { summary: "working", current: "tests" } },
      { action: "evaluation", goalId: "g1", now: 3, reason: "Need green tests", usage: { total: 50 } },
      { action: "pause", goalId: "g1", now: 4 },
      { action: "resume", goalId: "g1", now: 5 },
      { action: "complete", goalId: "g1", now: 6, evidence: "tests passed" },
    ]);

    expect(state?.status).toBe("complete");
    expect(state?.progress.summary).toBe("tests passed");
    expect(state?.lastEvaluationReason).toBe("tests passed");
  });

  it("replaces old goals with new ids", () => {
    const state = apply([
      { action: "create", goalId: "g1", objective: "old", now: 1 },
      { action: "replace", goalId: "g2", objective: "new", now: 2 },
      { action: "progress", goalId: "g1", now: 3, progress: { summary: "stale" } },
    ]);

    expect(state?.goalId).toBe("g2");
    expect(state?.objective).toBe("new");
    expect(state?.progress.summary).not.toBe("stale");
  });

  it("reconstructs from custom branch entries", () => {
    const snapshot = createGoalStateSnapshot([
      {
        type: "custom",
        customType: "thread-goal-state",
        data: {
          action: "create",
          event: { action: "create", goalId: "g1", objective: "ship", now: 1 },
          state: null,
        },
      },
      {
        type: "custom",
        customType: "thread-goal-state",
        data: {
          action: "progress",
          event: { action: "progress", goalId: "g1", now: 2, progress: { summary: "moving" } },
          state: null,
        },
      },
    ]);

    expect(snapshot.current?.objective).toBe("ship");
    expect(snapshot.current?.progress.summary).toBe("moving");
  });
});
