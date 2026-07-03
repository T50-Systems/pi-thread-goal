import type { EvaluatorMessage, GoalEvaluatorProvider } from "./evaluator-provider.js";
import {
	parseEvaluatorDecision,
	resolveEvaluatorTimeoutMs,
} from "./evaluator-policy.js";
import { piEvaluatorProvider } from "./pi-evaluator-provider.js";
import { renderGoalEvaluationPrompt } from "./prompts.js";
import type { EvaluatorDecision, GoalState } from "./types.js";
import type { GoalRuntimeContext } from "./runtime-types.js";

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
