import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { validateGoalCompletion } from "./completion-policy.js";
import { loadGoalState, saveGoalState, validateObjective } from "./state.js";
import type { GoalProgress, GoalState } from "./types.js";
export { validateGoalCompletion } from "./completion-policy.js";

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
    description: "Read the current /goal state for context.",
    promptSnippet: "Use get_goal quietly when persisted /goal context is needed.",
    promptGuidelines: ["Use get_goal only when the persisted /goal state is needed; do not narrate the internal lookup to the user."],
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
          source: "model-tool",
          explicitUserIntent: true,
          causedBy: "create_goal",
        },
        current,
      );
      return {
        content: [{ type: "text", text: next ? "Goal created." : "Goal not created." }],
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
      "Resolve blockers and update current progress before completing the goal.",
    ],
    parameters: completeGoalParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = loadGoalState(ctx as GoalToolContext);
      assertActiveGoal(current, "complete");
      const validation = validateGoalCompletion(current, params.evidence);
      if (!validation.ok) {
        throw new Error(validation.reason);
      }
      const next = saveGoalState(
        pi,
        {
          action: "complete",
          goalId: current.goalId,
          now: Date.now(),
          evidence: params.evidence,
          source: "model-tool",
          explicitUserIntent: false,
          causedBy: "complete_goal",
        },
        current,
      );
      return {
        content: [{ type: "text", text: next ? "Goal completed." : "Goal not completed." }],
        details: { goal: next },
        terminate: Boolean(next && next.status === "complete"),
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
      assertActiveGoal(current, "update");
      const next = saveGoalState(
        pi,
        {
          action: "progress",
          goalId: current.goalId,
          now: Date.now(),
          progress: normalizeProgressInput(params),
          source: "model-tool",
          explicitUserIntent: false,
          causedBy: "update_goal_progress",
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

function assertActiveGoal(goal: GoalState | null, action: string): asserts goal is GoalState {
  if (!goal) {
    throw new Error(`No goal exists to ${action}.`);
  }
  if (goal.status !== "active") {
    throw new Error(`Goal is not active; current status is ${goal.status}.`);
  }
}


export function formatGoal(goal: GoalState): string {
  return [
    `/goal ${goal.status}`,
    goal.progress.current ? `Now: ${goal.progress.current}` : undefined,
    `Progress: ${goal.progress.summary || "No progress recorded yet."}`,
    goal.progress.blocked.length > 0 ? `Blocked: ${goal.progress.blocked.join("; ")}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function formatGoalProgressUpdate(_goal: GoalState): string {
  return "Progress noted.";
}
