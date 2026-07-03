import { describe, expect, it, vi } from "vitest";
import { formatGoal, formatGoalProgressUpdate, registerGoalTools, validateGoalCompletion } from "../src/tools.js";
import type { GoalState } from "../src/types.js";

const goal: GoalState = {
  version: 1,
  goalId: "g1",
  objective: "ship the feature",
  status: "active",
  acceptanceCriteria: [],
  sourcePaths: [],
  progress: { done: [], blocked: [], summary: "tests are green", current: "write docs" },
  createdAt: 1,
  updatedAt: 1,
  runStartedAt: 1,
  evaluationTurns: 2,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  lastEvaluationReason: "keep going",
};

describe("goal tool user-facing text", () => {
  it("keeps get_goal output concise and avoids echoing the full objective", () => {
    const text = formatGoal(goal);

    expect(text).toContain("/goal active");
    expect(text).toContain("Now: write docs");
    expect(text).not.toContain(goal.objective);
    expect(text).not.toContain("Evaluator");
  });

  it("uses a quiet progress acknowledgement", () => {
    expect(formatGoalProgressUpdate(goal)).toBe("Progress noted.");
  });
});

describe("goal completion validation", () => {
  it("rejects blockers and missing evidence", () => {
    expect(validateGoalCompletion({ ...goal, progress: { ...goal.progress, blocked: ["waiting on tests"] } }, "tests passed")).toEqual({
      ok: false,
      reason: "Cannot complete goal with unresolved blockers: waiting on tests.",
    });
    expect(validateGoalCompletion({ ...goal, acceptanceCriteria: ["tests pass"], progress: { done: [], blocked: [], summary: "" } }, undefined).ok).toBe(false);
  });

  it("allows clean completion with evidence", () => {
    expect(
      validateGoalCompletion(
        {
          ...goal,
          acceptanceCriteria: ["tests pass"],
          progress: { done: ["write docs"], blocked: [], summary: "tests passed", current: "write docs" },
        },
        "tests passed and criteria completed",
      ),
    ).toEqual({ ok: true });
  });
});

describe("registered goal tools", () => {
  it("complete_goal returns terminate=true only on successful completion", async () => {
    const tools = new Map<string, any>();
    const branchEntries: any[] = [
      {
        type: "custom",
        customType: "thread-goal-state",
        data: {
          action: "create",
          event: { action: "create", goalId: "g1", objective: "ship", now: 1 },
          state: null,
        },
      },
    ];
    const appendEntry = vi.fn((customType: string, data: unknown) => branchEntries.push({ type: "custom", customType, data }));
    registerGoalTools({ registerTool: (tool: any) => tools.set(tool.name, tool), appendEntry } as any);

    const result = await tools.get("complete_goal").execute(
      "tc1",
      { evidence: "done and tests passed" },
      undefined,
      undefined,
      { sessionManager: { getBranch: () => branchEntries } },
    );

    expect(result.terminate).toBe(true);
    expect(result.details.goal.status).toBe("complete");
    expect(appendEntry).toHaveBeenCalledTimes(1);
  });

  it("rejects stale tool calls against paused goals", async () => {
    const tools = new Map<string, any>();
    const branchEntries: any[] = [
      {
        type: "custom",
        customType: "thread-goal-state",
        data: { action: "create", event: { action: "create", goalId: "g1", objective: "ship", now: 1 }, state: null },
      },
      {
        type: "custom",
        customType: "thread-goal-state",
        data: { action: "pause", event: { action: "pause", goalId: "g1", now: 2 }, state: null },
      },
    ];
    const appendEntry = vi.fn();
    registerGoalTools({ registerTool: (tool: any) => tools.set(tool.name, tool), appendEntry } as any);

    await expect(
      tools.get("update_goal_progress").execute(
        "tc1",
        { summary: "still working" },
        undefined,
        undefined,
        { sessionManager: { getBranch: () => branchEntries } },
      ),
    ).rejects.toThrow("Goal is not active; current status is paused.");
    expect(appendEntry).not.toHaveBeenCalled();
  });
});
