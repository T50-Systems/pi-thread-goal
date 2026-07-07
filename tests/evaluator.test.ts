import { describe, expect, it } from "vitest";
import { evaluateGoal } from "../src/evaluator.js";
import {
	classifyGoalRuntimeError,
	DEFAULT_EVALUATOR_TIMEOUT_MS,
	parseEvaluatorDecision,
	resolveEvaluatorTimeoutMs,
} from "../src/evaluator-policy.js";
import type { GoalState } from "../src/types.js";
import type { GoalRuntimeContext } from "../src/runtime-types.js";

const goal: GoalState = {
	version: 1,
	revision: 1,
	goalId: "g1",
	objective: "ship",
	status: "active",
	acceptanceCriteria: [],
	sourcePaths: [],
	progress: { done: [], blocked: [], summary: "" },
	createdAt: 1,
	updatedAt: 1,
	runStartedAt: 1,
	evaluationTurns: 0,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	lastEvaluationReason: "Goal started.",
};

describe("parseEvaluatorDecision", () => {
	it("parses strict or fenced-ish JSON from evaluator text", () => {
		expect(parseEvaluatorDecision('{"met":true,"reason":"done"}')).toEqual({
			met: true,
			reason: "done",
		});
		expect(
			parseEvaluatorDecision('prefix {"met":false,"reason":"more"}'),
		).toEqual({
			met: false,
			reason: "more",
		});
	});

	it("falls back to continue when JSON is invalid", () => {
		expect(parseEvaluatorDecision("not json")).toEqual({
			met: false,
			reason: "not json",
		});
	});
});

describe("resolveEvaluatorTimeoutMs", () => {
	it("uses override, valid env, or default timeout", () => {
		expect(resolveEvaluatorTimeoutMs(123, {})).toBe(123);
		expect(
			resolveEvaluatorTimeoutMs(undefined, {
				GOAL_EVALUATOR_TIMEOUT_MS: "500",
			}),
		).toBe(500);
		expect(
			resolveEvaluatorTimeoutMs(undefined, {
				GOAL_EVALUATOR_TIMEOUT_MS: "bad",
			}),
		).toBe(DEFAULT_EVALUATOR_TIMEOUT_MS);
		expect(resolveEvaluatorTimeoutMs(undefined, {})).toBe(
			DEFAULT_EVALUATOR_TIMEOUT_MS,
		);
	});
});

describe("classifyGoalRuntimeError", () => {
	it("classifies transient runtime/provider interruptions as retryable", () => {
		expect(
			classifyGoalRuntimeError(new DOMException("aborted", "AbortError")),
		).toBe("retryable");
		expect(classifyGoalRuntimeError(new Error("timed out"))).toBe("retryable");
		expect(classifyGoalRuntimeError(new Error("provider rate limit"))).toBe(
			"retryable",
		);
		expect(classifyGoalRuntimeError(new Error("provider overload"))).toBe(
			"retryable",
		);
		expect(classifyGoalRuntimeError(new Error("temporary unavailable"))).toBe(
			"retryable",
		);
		expect(
			classifyGoalRuntimeError(
				new Error("compact retry interrupted evaluator"),
			),
		).toBe("retryable");
	});

	it("classifies fatal configuration/request failures as non-retryable", () => {
		expect(classifyGoalRuntimeError(new Error("invalid api key"))).toBe(
			"non-retryable",
		);
		expect(classifyGoalRuntimeError(new Error("bad request"))).toBe(
			"non-retryable",
		);
		expect(classifyGoalRuntimeError(new Error("auth failed"))).toBe(
			"non-retryable",
		);
		expect(classifyGoalRuntimeError(new Error("invalid evaluator auth"))).toBe(
			"non-retryable",
		);
	});
});

describe("evaluateGoal", () => {
	it("continues manually when no evaluator model is available", async () => {
		await expect(evaluateGoal(goal, makeCtx())).resolves.toEqual({
			met: false,
			reason:
				"No evaluator model available; continue manually or configure a small fast model.",
		});
	});

	it("reports auth failures without calling the provider", async () => {
		await expect(
			evaluateGoal(goal, {
				...makeCtx(),
				model: { provider: "anthropic", id: "custom" },
				modelRegistry: {
					find: () => undefined,
					getApiKeyAndHeaders: async () => ({ ok: false, error: "auth down" }),
				},
			}),
		).resolves.toEqual({ met: false, reason: "auth down" });
	});

	it("uses an injected evaluator provider instead of requiring a concrete adapter", async () => {
		const calls: unknown[] = [];
		await expect(
			evaluateGoal(
				goal,
				{
					...makeCtx(),
					model: { provider: "anthropic", id: "custom" },
					modelRegistry: {
						find: () => undefined,
						getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "key" }),
					},
				},
				{
					provider: {
						async complete(model, context, options) {
							calls.push({ model, context, options });
							return {
								content: [
									{ type: "text", text: '{"met":true,"reason":"done"}' },
								],
							};
						},
					},
				},
			),
		).resolves.toEqual({ met: true, reason: "done" });

		expect(calls).toHaveLength(1);
	});
});

function makeCtx(): GoalRuntimeContext {
	return {
		sessionManager: { getBranch: () => [] },
		goalProtocol: { sessionId: "test-session", branchId: "test-branch" },
		modelRegistry: {
			find: () => undefined,
			getApiKeyAndHeaders: async () => ({ ok: false }),
		},
	};
}
