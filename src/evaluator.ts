import { renderGoalEvaluationPrompt } from "./prompts.js";
import type {
	EvaluatorDecision,
	GoalRuntimeInterruptionKind,
	GoalState,
} from "./types.js";
import type { GoalRuntimeContext } from "./runtime-types.js";

// --- Evaluator ports ---

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

// --- Evaluator policy (pure) ---

export const DEFAULT_EVALUATOR_TIMEOUT_MS = 45_000;
export const EVALUATOR_TIMEOUT_ENV = "GOAL_EVALUATOR_TIMEOUT_MS";

export function resolveEvaluatorTimeoutMs(
	override?: number,
	env: NodeJS.ProcessEnv = process.env,
): number {
	if (
		typeof override === "number" &&
		Number.isFinite(override) &&
		override > 0
	) {
		return Math.floor(override);
	}

	const raw = env[EVALUATOR_TIMEOUT_ENV];
	if (!raw) return DEFAULT_EVALUATOR_TIMEOUT_MS;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0
		? Math.floor(parsed)
		: DEFAULT_EVALUATOR_TIMEOUT_MS;
}

export function parseEvaluatorDecision(text: string): EvaluatorDecision {
	const match = text.match(/\{[\s\S]*\}/);
	const candidate = match ? match[0] : text;
	try {
		const parsed = JSON.parse(candidate) as Partial<EvaluatorDecision>;
		return {
			met: Boolean(parsed.met),
			reason:
				typeof parsed.reason === "string"
					? parsed.reason
					: "Evaluator returned no reason.",
		};
	} catch {
		return {
			met: false,
			reason: text || "Evaluator response was not valid JSON.",
		};
	}
}

export function classifyGoalRuntimeError(
	error: unknown,
): GoalRuntimeInterruptionKind {
	if (isAbortLikeError(error)) return "retryable";
	const message = error instanceof Error ? error.message : String(error);
	if (
		/abort|cancel|compact|retry|timeout|timed out|temporary|temporarily|rate limit|overload/i.test(
			message,
		)
	)
		return "retryable";
	return "non-retryable";
}

function isAbortLikeError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return error.name === "AbortError" || error.name === "TimeoutError";
}

// --- Pi provider (only module that touches @earendil-works/pi-ai/compat) ---

const PI_AI_COMPAT_MODULE = "@earendil-works/pi-ai/compat";

type EvaluatorComplete = (
	model: never,
	context: { systemPrompt: string; messages: EvaluatorMessage[] },
	options: {
		apiKey?: string;
		headers?: Record<string, string>;
		signal?: AbortSignal;
	},
) => Promise<EvaluatorResponse>;

export async function completeGoalEvaluation(
	model: never,
	context: { systemPrompt: string; messages: EvaluatorMessage[] },
	options: {
		apiKey?: string;
		headers?: Record<string, string>;
		signal?: AbortSignal;
	},
): Promise<EvaluatorResponse> {
	const compat = (await import(PI_AI_COMPAT_MODULE)) as {
		complete: EvaluatorComplete;
	};
	return compat.complete(model, context, options);
}

export function createPiEvaluatorProvider(): GoalEvaluatorProvider {
	return {
		complete(model, context, options) {
			return completeGoalEvaluation(model as never, context, options);
		},
	};
}

export const piEvaluatorProvider = createPiEvaluatorProvider();

// --- Evaluation service ---

const EVALUATOR_SYSTEM_PROMPT =
	'You evaluate whether a goal condition is already satisfied. Read the goal condition and the conversation evidence. Return strict JSON only: {"met": boolean, "reason": string}. The reason must be one concise sentence.';

export interface EvaluateGoalOptions {
	timeoutMs?: number;
	provider?: GoalEvaluatorProvider;
}

export async function evaluateGoal(
	goal: GoalState,
	ctx: GoalRuntimeContext,
	options: EvaluateGoalOptions = {},
): Promise<EvaluatorDecision> {
	const model = pickEvaluatorModel(ctx);
	if (!model) {
		return {
			met: false,
			reason:
				"No evaluator model available; continue manually or configure a small fast model.",
		};
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		return {
			met: false,
			reason: auth.ok
				? "No evaluator API key available for the selected provider."
				: auth.error || "Evaluator auth failed.",
		};
	}

	const message: EvaluatorMessage = {
		role: "user",
		content: [{ type: "text", text: renderGoalEvaluationPrompt(goal) }],
		timestamp: Date.now(),
	};

	const provider = options.provider ?? piEvaluatorProvider;
	const response = await withTimeout(
		provider.complete(
			model,
			{ systemPrompt: EVALUATOR_SYSTEM_PROMPT, messages: [message] },
			{ apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal },
		),
		resolveEvaluatorTimeoutMs(options.timeoutMs),
		"Goal evaluator timed out.",
	);

	const text = response.content
		.flatMap((content) => (content.type === "text" ? [content.text] : []))
		.join("\n")
		.trim();

	return parseEvaluatorDecision(text);
}

function pickEvaluatorModel(ctx: GoalRuntimeContext): unknown {
	const provider = ctx.model?.provider;
	if (!provider) return ctx.model;

	const candidatesByProvider: Record<string, string[]> = {
		anthropic: [
			"claude-haiku-4-5",
			"claude-haiku-4",
			"claude-3-5-haiku-latest",
		],
		openai: ["gpt-5-nano", "gpt-5-mini", "gpt-4.1-mini"],
		"openai-codex": ["gpt-5-nano", "gpt-5-mini", "gpt-4.1-mini"],
		google: ["gemini-2.5-flash", "gemini-2.0-flash"],
	};

	for (const id of candidatesByProvider[provider] ?? []) {
		const found = ctx.modelRegistry.find(provider, id);
		if (found) return found;
	}

	return ctx.model;
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message: string,
): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
