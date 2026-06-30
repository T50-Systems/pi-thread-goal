import type { GoalEvent, GoalProgress, GoalState, GoalStateEntry, GoalStateSnapshot } from "./types.js";

export const GOAL_CUSTOM_TYPE = "thread-goal-state";
export const MAX_OBJECTIVE_LENGTH = 4000;

interface GoalSessionEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

interface GoalSessionContext {
  sessionManager: {
    getBranch(): GoalSessionEntry[];
  };
}

interface GoalAppendAPI {
  appendEntry(customType: string, data?: unknown): unknown;
}

export class GoalStateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalStateValidationError";
  }
}

export function validateObjective(objective: string): string {
  const trimmed = objective.trim();
  if (trimmed.length === 0) {
    throw new GoalStateValidationError("Goal objective must be non-empty.");
  }
  if (trimmed.length > MAX_OBJECTIVE_LENGTH) {
    throw new GoalStateValidationError(
      `Goal objective must be ${MAX_OBJECTIVE_LENGTH} characters or fewer.`,
    );
  }
  return trimmed;
}

export function createGoalState(
  event: Extract<GoalEvent, { action: "create" | "replace" }>,
): GoalState {
  return {
    version: 1,
    goalId: event.goalId,
    objective: validateObjective(event.objective),
    status: "active",
    acceptanceCriteria: normalizeList(event.acceptanceCriteria),
    sourcePaths: normalizeList(event.sourcePaths),
    progress: normalizeProgress(),
    createdAt: event.now,
    updatedAt: event.now,
    runStartedAt: event.now,
    evaluationTurns: 0,
    usage: emptyUsage(),
    lastEvaluationReason: "Goal started.",
  };
}

export function reduceGoalState(current: GoalState | null, event: GoalEvent): GoalState | null {
  switch (event.action) {
    case "create":
      return current ?? createGoalState(event);
    case "replace":
      return createGoalState(event);
    case "edit": {
      if (!isCurrentGoal(current, event.goalId)) return current;
      return {
        ...current,
        objective: event.objective === undefined ? current.objective : validateObjective(event.objective),
        acceptanceCriteria:
          event.acceptanceCriteria === undefined
            ? current.acceptanceCriteria
            : normalizeList(event.acceptanceCriteria),
        sourcePaths:
          event.sourcePaths === undefined ? current.sourcePaths : normalizeList(event.sourcePaths),
        updatedAt: event.now,
      };
    }
    case "pause":
      if (!isCurrentGoal(current, event.goalId) || current.status !== "active") return current;
      return { ...current, status: "paused", updatedAt: event.now };
    case "resume":
      if (!isCurrentGoal(current, event.goalId) || current.status !== "paused") return current;
      return {
        ...current,
        status: "active",
        updatedAt: event.now,
        runStartedAt: event.now,
        evaluationTurns: 0,
        usage: emptyUsage(),
        lastEvaluationReason: "Goal resumed.",
      };
    case "clear":
      return isCurrentGoal(current, event.goalId) ? null : current;
    case "complete":
      if (!isCurrentGoal(current, event.goalId) || current.status !== "active") return current;
      return {
        ...current,
        status: "complete",
        updatedAt: event.now,
        completedAt: event.now,
        lastEvaluationReason: event.evidence?.trim() || current.lastEvaluationReason || "Goal completed.",
        progress: {
          ...current.progress,
          summary: event.evidence?.trim() || current.progress.summary || "Goal completed.",
        },
      };
    case "progress":
      if (!isCurrentGoal(current, event.goalId) || current.status !== "active") return current;
      return {
        ...current,
        updatedAt: event.now,
        progress: normalizeProgress(event.progress, current.progress),
      };
    case "evaluation":
      if (!isCurrentGoal(current, event.goalId) || current.status !== "active") return current;
      return {
        ...current,
        updatedAt: event.now,
        evaluationTurns: current.evaluationTurns + 1,
        lastEvaluationReason: event.reason.trim() || current.lastEvaluationReason,
        usage: mergeUsage(current.usage, event.usage),
      };
    default:
      return current;
  }
}

export function toGoalStateEntry(event: GoalEvent, current: GoalState | null): GoalStateEntry {
  return {
    action: event.action,
    state: cloneGoalState(reduceGoalState(current, event)),
    event: cloneEvent(event),
  };
}

export function saveGoalState(
  pi: GoalAppendAPI,
  event: GoalEvent,
  current: GoalState | null,
): GoalState | null {
  const entry = toGoalStateEntry(event, current);
  pi.appendEntry(GOAL_CUSTOM_TYPE, entry);
  return cloneGoalState(entry.state);
}

export function loadGoalState(ctx: GoalSessionContext): GoalState | null {
  return createGoalStateSnapshot(ctx.sessionManager.getBranch()).current;
}

export function createGoalStateSnapshot(branchEntries: GoalSessionEntry[]): GoalStateSnapshot {
  let current: GoalState | null = null;
  const entries: GoalStateEntry[] = [];

  for (const branchEntry of branchEntries) {
    if (branchEntry.type !== "custom" || branchEntry.customType !== GOAL_CUSTOM_TYPE) continue;
    const goalEntry = parseGoalStateEntry(branchEntry.data);
    if (!goalEntry) continue;
    current = reduceGoalState(current, goalEntry.event);
    entries.push({ ...goalEntry, state: cloneGoalState(current) });
  }

  return { current: cloneGoalState(current), entries };
}

function parseGoalStateEntry(data: unknown): GoalStateEntry | null {
  if (!isRecord(data) || !isGoalEvent(data.event) || !("action" in data)) return null;
  return {
    action: data.event.action,
    state: isGoalState(data.state) ? cloneGoalState(data.state) : null,
    event: cloneEvent(data.event),
  };
}

function isCurrentGoal(current: GoalState | null, goalId: string): current is GoalState {
  return current !== null && current.goalId === goalId;
}

function normalizeProgress(progress: Partial<GoalProgress> = {}, base?: GoalProgress): GoalProgress {
  return {
    done: normalizeList(progress.done ?? base?.done),
    current: normalizeText(progress.current ?? base?.current),
    blocked: normalizeList(progress.blocked ?? base?.blocked),
    summary: normalizeText(progress.summary ?? base?.summary) ?? "",
  };
}

function normalizeList(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cloneGoalState(state: GoalState | null): GoalState | null {
  return state === null
    ? null
    : {
        ...state,
        acceptanceCriteria: [...state.acceptanceCriteria],
        sourcePaths: [...state.sourcePaths],
        usage: { ...state.usage },
        progress: {
          done: [...state.progress.done],
          blocked: [...state.progress.blocked],
          current: state.progress.current,
          summary: state.progress.summary,
        },
      };
}

function cloneEvent(event: GoalEvent): GoalEvent {
  return JSON.parse(JSON.stringify(event)) as GoalEvent;
}

function isGoalState(value: unknown): value is GoalState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.goalId === "string" &&
    typeof value.objective === "string" &&
    isGoalStatus(value.status)
  );
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function mergeUsage(current: GoalState["usage"], delta: Partial<GoalState["usage"]> | undefined) {
  return {
    input: current.input + Math.max(0, delta?.input ?? 0),
    output: current.output + Math.max(0, delta?.output ?? 0),
    cacheRead: current.cacheRead + Math.max(0, delta?.cacheRead ?? 0),
    cacheWrite: current.cacheWrite + Math.max(0, delta?.cacheWrite ?? 0),
    total: current.total + Math.max(0, delta?.total ?? 0),
  };
}

function isGoalEvent(value: unknown): value is GoalEvent {
  return isRecord(value) && typeof value.action === "string" && typeof value.goalId === "string";
}

function isGoalStatus(value: unknown): boolean {
  return value === "active" || value === "paused" || value === "complete";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
