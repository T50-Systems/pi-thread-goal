import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadGoalState, saveGoalState, validateObjective } from "./state.js";
import type { GoalProgress, GoalState } from "./types.js";

const getGoalParams = Type.Object({}, { additionalProperties: false });
const createGoalParams = Type.Object(
  {
    objective: Type.String({ description: "The concrete user-approved objective to start pursuing." }),
    explicit_request: Type.Boolean({
      description: "Must be true only when the user or system/developer instructions explicitly requested a goal.",
    }),
    acceptance_criteria: Type.Optional(Type.Array(Type.String())),
    source_paths: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);
const completeGoalParams = Type.Object(
  {
    evidence: Type.Optional(Type.String({ description: "Optional completion evidence." })),
  },
  { additionalProperties: false },
);
const updateGoalProgressParams = Type.Object(
  {
    done: Type.Optional(Type.Array(Type.String())),
    current: Type.Optional(Type.String()),
    blocked: Type.Optional(Type.Array(Type.String())),
    summary: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

interface GoalToolContext {
  sessionManager: { getBranch(): Array<{ type: string; customType?: string; data?: unknown }> };
}

export function registerGoalTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "get_goal",
    label: "Get Goal",
    description: "Get the current active /goal state, progress, and relevant paths.",
    promptSnippet: "Use get_goal to read the current persisted /goal state before goal-directed work.",
    promptGuidelines: ["Use get_goal when you need the current persisted /goal state before acting."],
    parameters: getGoalParams,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const current = loadGoalState(ctx as GoalToolContext);
      return {
        content: [{ type: "text", text: current ? formatGoal(current) : "No goal is currently set." }],
        details: { goal: current },
      };
    },
  });

  pi.registerTool({
    name: "create_goal",
    label: "Create Goal",
    description: "Create a goal only when explicitly requested by the user or system/developer instructions.",
    promptSnippet: "Use create_goal only for an explicitly requested new /goal.",
    promptGuidelines: [
      "Use create_goal only when the user or higher-priority instructions explicitly ask to create a goal.",
      "Use create_goal only when no active or paused goal already exists.",
    ],
    parameters: createGoalParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!params.explicit_request) {
        throw new Error("create_goal requires explicit_request=true.");
      }
      const current = loadGoalState(ctx as GoalToolContext);
      if (current) {
        throw new Error("A goal already exists. Replace it only through an explicit user command.");
      }
      const next = saveGoalState(
        pi,
        {
          action: "create",
          goalId: crypto.randomUUID(),
          objective: validateObjective(params.objective),
          now: Date.now(),
          acceptanceCriteria: params.acceptance_criteria,
          sourcePaths: params.source_paths,
        },
        current,
      );
      return {
        content: [{ type: "text", text: next ? `Goal created: ${next.objective}` : "Goal not created." }],
        details: { goal: next },
      };
    },
  });

  pi.registerTool({
    name: "complete_goal",
    label: "Complete Goal",
    description: "Mark the active goal complete only when the objective is actually achieved.",
    promptSnippet: "Use complete_goal only when the current /goal is actually complete.",
    promptGuidelines: [
      "Use complete_goal only when evidence shows the current objective is complete.",
      "Do not use complete_goal to stop work early or to pause a goal.",
    ],
    parameters: completeGoalParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = loadGoalState(ctx as GoalToolContext);
      if (!current) {
        throw new Error("No goal exists to complete.");
      }
      const next = saveGoalState(
        pi,
        { action: "complete", goalId: current.goalId, now: Date.now(), evidence: params.evidence },
        current,
      );
      return {
        content: [{ type: "text", text: next ? `Goal completed: ${next.objective}` : "Goal not completed." }],
        details: { goal: next },
      };
    },
  });

  pi.registerTool({
    name: "update_goal_progress",
    label: "Update Goal Progress",
    description: "Update execution progress for the active goal without changing the objective.",
    promptSnippet: "Use update_goal_progress to persist progress for the current /goal.",
    promptGuidelines: [
      "Use update_goal_progress to update done/current/blocked/summary for the active goal.",
      "Do not use update_goal_progress to rewrite the goal objective itself.",
    ],
    parameters: updateGoalProgressParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = loadGoalState(ctx as GoalToolContext);
      if (!current) {
        throw new Error("No goal exists to update.");
      }
      const next = saveGoalState(
        pi,
        {
          action: "progress",
          goalId: current.goalId,
          now: Date.now(),
          progress: normalizeProgressInput(params),
        },
        current,
      );
      return {
        content: [{ type: "text", text: next ? formatGoalProgressUpdate(next) : "Progress not updated." }],
        details: { goal: next },
      };
    },
  });
}

function normalizeProgressInput(params: {
  done?: string[];
  current?: string;
  blocked?: string[];
  summary?: string;
}): Partial<GoalProgress> {
  return {
    done: params.done,
    current: params.current,
    blocked: params.blocked,
    summary: params.summary,
  };
}

function formatGoal(goal: GoalState): string {
  return [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Progress: ${goal.progress.summary || "No progress recorded yet."}`,
    goal.progress.current ? `Current: ${goal.progress.current}` : undefined,
    goal.progress.blocked.length > 0 ? `Blocked: ${goal.progress.blocked.join("; ")}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function formatGoalProgressUpdate(goal: GoalState): string {
  return `Progress updated for goal: ${goal.objective}`;
}
