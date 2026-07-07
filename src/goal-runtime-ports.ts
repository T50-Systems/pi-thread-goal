import type {
	GoalContinuationMode,
	GoalContinuationPhase,
	GoalState,
} from "./types.js";

export interface GoalStateStore {
	markPending(
		goal: GoalState,
		reason: string,
		options?: {
			phase?: Extract<GoalContinuationPhase, "queued" | "stale-retry">;
		},
	): GoalState | null;
	markSent(
		goal: GoalState,
		options: { reason: string; mode: GoalContinuationMode },
	): GoalState | null;
	markFailed(
		goal: GoalState,
		options: { reason: string; mode?: GoalContinuationMode; error: string },
	): GoalState | null;
}

export interface GoalMessageQueue {
	send(prompt: string, mode: "immediate" | "followUp"): void;
}

export interface GoalNotifier {
	notify?(message: string, level?: "info" | "warning" | "error"): void;
}

export interface GoalRuntimeIdleProbe {
	isIdle?: () => boolean;
	hasPendingMessages?: () => boolean;
}

