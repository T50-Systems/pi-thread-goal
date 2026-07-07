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

export interface EvaluatorMessage {
	role: "user";
	content: Array<{ type: "text"; text: string }>;
	timestamp: number;
}

export interface EvaluatorResponse {
	content: Array<{ type: string; text?: string }>;
}

export interface GoalEvaluatorProvider {
	complete(
		model: unknown,
		context: { systemPrompt: string; messages: EvaluatorMessage[] },
		options: {
			apiKey?: string;
			headers?: Record<string, string>;
			signal?: AbortSignal;
		},
	): Promise<EvaluatorResponse>;
}
