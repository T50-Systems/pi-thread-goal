import type { GoalProtocolContext } from "./goal-protocol.js";
import type { EvaluatorDecision } from "./types.js";

export interface GoalRuntimeContext {
	sessionManager: {
		getBranch(): Array<{ type: string; customType?: string; data?: unknown }>;
		sessionId?: string;
		leafId?: string | null;
	};
	goalProtocol?: GoalProtocolContext;
	model?: { provider: string; id: string };
	modelRegistry: {
		find(provider: string, id: string): unknown;
		getApiKeyAndHeaders(model: unknown): Promise<{
			ok: boolean;
			apiKey?: string;
			headers?: Record<string, string>;
			error?: string;
		}>;
	};
	signal?: AbortSignal;
	isIdle?: () => boolean;
	hasPendingMessages?: () => boolean;
	ui?: {
		notify?: (message: string, level?: "info" | "warning" | "error") => void;
		setStatus?: (key: string, value: string | undefined) => void;
		setWidget?: (key: string, value: string[] | undefined) => void;
	};
}

export interface RuntimeExtensionAPI {
	on(
		event: "before_agent_start",
		handler: (event: unknown, ctx: unknown) => unknown,
	): void;
	on(
		event: "context",
		handler: (event: ContextEvent, ctx: unknown) => unknown,
	): void;
	on(
		event: "session_before_compact",
		handler: (event: SessionBeforeCompactEvent, ctx: unknown) => unknown,
	): void;
	on(
		event: "session_compact",
		handler: (event: CompactionResumeEvent, ctx: unknown) => unknown,
	): void;
	on(
		event: "session_start",
		handler: (event: SessionStartEvent, ctx: unknown) => unknown,
	): void;
	on(
		event: "session_tree",
		handler: (event: unknown, ctx: unknown) => unknown,
	): void;
	on(
		event: "agent_end",
		handler: (event: AgentEndEvent, ctx: unknown) => unknown,
	): void;
	appendEntry(customType: string, data?: unknown): unknown;
	sendUserMessage(prompt: string, options?: { deliverAs: "followUp" }): unknown;
}

export interface ContextMessage {
	customType?: string;
	content?: unknown;
	details?: unknown;
}

export interface ContextEvent {
	messages: ContextMessage[];
}

export interface SessionBeforeCompactEvent {
	preparation: {
		previousSummary?: string;
		firstKeptEntryId?: string;
		tokensBefore?: number;
	};
}

export interface AgentEndEvent {
	messages: unknown[];
}

export interface CompactionResumeEvent {
	reason: "manual" | "threshold" | "overflow";
	willRetry: boolean;
}

export interface RuntimeIdleContext {
	isIdle?: () => boolean;
	hasPendingMessages?: () => boolean;
}

export interface SessionStartEvent {
	reason: string;
}

export type { EvaluatorDecision };
