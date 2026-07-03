import type {
	EvaluatorDecision,
	GoalRuntimeInterruptionKind,
} from "./types.js";

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
