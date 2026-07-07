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

export type GoalPauseReason =
	| "manual"
	| "turn-limit"
	| "token-budget"
	| "error";

export type GoalContinuationPhase =
	| "queued"
	| "sent"
	| "started"
	| "cleared"
	| "failed"
	| "stale-retry";

export type GoalContinuationMode = "immediate" | "followUp";

export interface GoalState {
	version: 1;
	goalId: string;
	objective: string;
	status: GoalStatus;
	acceptanceCriteria: string[];
	sourcePaths: string[];
	tokenBudget?: number;
	pauseReason?: GoalPauseReason;
	pauseMessage?: string;
	progress: GoalProgress;
	createdAt: number;
	updatedAt: number;
	runStartedAt: number;
	evaluationTurns: number;
	usage: GoalUsage;
	lastEvaluationReason: string;
	completedAt?: number;
	dismissedAt?: number;
	continuationPendingAt?: number;
	continuationReason?: string;
	continuationPhase?: GoalContinuationPhase;
	continuationAttempt?: number;
	continuationFailures?: number;
	continuationLastError?: string;
	continuationLastMode?: GoalContinuationMode;
	continuationLastSentAt?: number;
	continuationLastStartedAt?: number;
}

export type GoalEventSource =
	| "user-command"
	| "model-tool"
	| "runtime"
	| "compaction"
	| "session"
	| "legacy-replay";

export interface GoalEventMetadata {
	source?: GoalEventSource;
	explicitUserIntent?: boolean;
	causedBy?: string;
}

export interface GoalCreateEvent extends GoalEventMetadata {
	action: "create";
	goalId: string;
	objective: string;
	now: number;
	acceptanceCriteria?: string[];
	sourcePaths?: string[];
	tokenBudget?: number;
}

export interface GoalReplaceEvent extends Omit<GoalCreateEvent, "action"> {
	action: "replace";
}

export interface GoalEditEvent extends GoalEventMetadata {
	action: "edit";
	goalId: string;
	now: number;
	objective?: string;
	acceptanceCriteria?: string[];
	sourcePaths?: string[];
	tokenBudget?: number;
}

export interface GoalPauseEvent extends GoalEventMetadata {
	action: "pause";
	goalId: string;
	now: number;
	reason?: GoalPauseReason;
	message?: string;
}

export interface GoalResumeEvent extends GoalEventMetadata {
	action: "resume";
	goalId: string;
	now: number;
}

export interface GoalClearEvent extends GoalEventMetadata {
	action: "clear";
	goalId: string;
	now: number;
}

export interface GoalCompleteEvent extends GoalEventMetadata {
	action: "complete";
	goalId: string;
	now: number;
	evidence?: string;
}

export interface GoalDismissEvent extends GoalEventMetadata {
	action: "dismiss";
	goalId: string;
	now: number;
}

export interface GoalProgressEvent extends GoalEventMetadata {
	action: "progress";
	goalId: string;
	now: number;
	progress: Partial<GoalProgress>;
}

export interface GoalEvaluationEvent extends GoalEventMetadata {
	action: "evaluation";
	goalId: string;
	now: number;
	reason: string;
	usage?: Partial<GoalUsage>;
}

export interface GoalContinuationEvent extends GoalEventMetadata {
	action: "continuation";
	goalId: string;
	now: number;
	pending: boolean;
	phase?: GoalContinuationPhase;
	reason?: string;
	mode?: GoalContinuationMode;
	error?: string;
}

export type GoalEvent =
	| GoalCreateEvent
	| GoalReplaceEvent
	| GoalEditEvent
	| GoalPauseEvent
	| GoalResumeEvent
	| GoalClearEvent
	| GoalCompleteEvent
	| GoalDismissEvent
	| GoalProgressEvent
	| GoalEvaluationEvent
	| GoalContinuationEvent;

export interface GoalStateEntry {
	action: GoalEvent["action"];
	state: GoalState | null;
	event: GoalEvent;
}

export interface GoalStateSnapshot {
	current: GoalState | null;
	entries: GoalStateEntry[];
}

export interface EvaluatorDecision {
	met: boolean;
	reason: string;
}

export type GoalRuntimeInterruptionKind = "retryable" | "non-retryable";
