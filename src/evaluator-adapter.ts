import type { EvaluatorMessage, EvaluatorResponse } from "./evaluator-provider.js";

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
