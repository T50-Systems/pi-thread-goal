export type GoalStatus = "active" | "paused" | "complete";

export interface GoalProgress {
  done: string[];
  current?: string;
  blocked: string[];
  summary: string;
}

export interface GoalUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface GoalState {
  version: 1;
  goalId: string;
  objective: string;
  status: GoalStatus;
  acceptanceCriteria: string[];
  sourcePaths: string[];
  progress: GoalProgress;
  createdAt: number;
  updatedAt: number;
  runStartedAt: number;
  evaluationTurns: number;
  usage: GoalUsage;
  lastEvaluationReason: string;
  completedAt?: number;
}

export interface GoalCreateEvent {
  action: "create";
  goalId: string;
  objective: string;
  now: number;
  acceptanceCriteria?: string[];
  sourcePaths?: string[];
}

export interface GoalReplaceEvent extends Omit<GoalCreateEvent, "action"> {
  action: "replace";
}

export interface GoalEditEvent {
  action: "edit";
  goalId: string;
  now: number;
  objective?: string;
  acceptanceCriteria?: string[];
  sourcePaths?: string[];
}

export interface GoalPauseEvent {
  action: "pause";
  goalId: string;
  now: number;
}

export interface GoalResumeEvent {
  action: "resume";
  goalId: string;
  now: number;
}

export interface GoalClearEvent {
  action: "clear";
  goalId: string;
  now: number;
}

export interface GoalCompleteEvent {
  action: "complete";
  goalId: string;
  now: number;
  evidence?: string;
}

export interface GoalProgressEvent {
  action: "progress";
  goalId: string;
  now: number;
  progress: Partial<GoalProgress>;
}

export interface GoalEvaluationEvent {
  action: "evaluation";
  goalId: string;
  now: number;
  reason: string;
  usage?: Partial<GoalUsage>;
}

export type GoalEvent =
  | GoalCreateEvent
  | GoalReplaceEvent
  | GoalEditEvent
  | GoalPauseEvent
  | GoalResumeEvent
  | GoalClearEvent
  | GoalCompleteEvent
  | GoalProgressEvent
  | GoalEvaluationEvent;

export interface GoalStateEntry {
  action: GoalEvent["action"];
  state: GoalState | null;
  event: GoalEvent;
}

export interface GoalStateSnapshot {
  current: GoalState | null;
  entries: GoalStateEntry[];
}
