import { describe, expect, it, vi } from "vitest";
import {
	clearQueuedGoalContinuation,
	CONTINUATION_WATCHDOG_MS,
	MAX_CONTINUATION_DELIVERY_ATTEMPTS,
	queueGoalContinuation,
	shouldQueueGoalContinuation,
	shouldResumeGoalAfterSessionStart,
	shouldRetryPendingContinuation,
	shouldPauseForContinuationDeliveryFailure,
} from "../src/continuation.js";
import type { GoalState } from "../src/types.js";
import type { GoalRuntimeContext } from "../src/runtime-types.js";

const goal: GoalState = {
	version: 1,
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

describe("resume and reentry continuation guards", () => {
	it("does not resume over pending messages", () => {
		expect(
			shouldResumeGoalAfterSessionStart(
				goal,
				{ reason: "resume" },
				{ isIdle: () => true, hasPendingMessages: () => true },
			),
		).toBe(false);
	});

	it("does not resume non-resume session starts or non-idle sessions", () => {
		expect(
			shouldResumeGoalAfterSessionStart(
				goal,
				{ reason: "new" },
				{ isIdle: () => true, hasPendingMessages: () => false },
			),
		).toBe(false);
		expect(
			shouldResumeGoalAfterSessionStart(
				goal,
				{ reason: "resume" },
				{ isIdle: () => false, hasPendingMessages: () => false },
			),
		).toBe(false);
	});

	it("deduplicates queued continuations for the same goal until the queue is cleared", () => {
		const guard = { queuedGoalId: null };

		expect(shouldQueueGoalContinuation(guard, goal)).toBe(true);
		expect(shouldQueueGoalContinuation(guard, goal)).toBe(false);

		shouldResumeGoalAfterSessionStart(
			goal,
			{ reason: "resume" },
			{ isIdle: () => true, hasPendingMessages: () => false },
			guard,
		);
		expect(guard.queuedGoalId).toBe("g1");

		expect(shouldQueueGoalContinuation(guard, { ...goal, goalId: "g2" })).toBe(
			true,
		);
	});

	it("allows the same goal to queue again after an agent turn starts", () => {
		const guard = { queuedGoalId: null };

		expect(shouldQueueGoalContinuation(guard, goal)).toBe(true);
		clearQueuedGoalContinuation(guard, goal.goalId);
		expect(shouldQueueGoalContinuation(guard, goal)).toBe(true);
	});
});

describe("pending continuation watchdog", () => {
	it("retries stale pending continuations only when idle with no pending messages", () => {
		const pendingGoal = {
			...goal,
			continuationPendingAt: 1_000,
		};

		expect(
			shouldRetryPendingContinuation(
				pendingGoal,
				{ isIdle: () => true, hasPendingMessages: () => false },
				1_000 + CONTINUATION_WATCHDOG_MS,
			),
		).toBe(true);
		expect(
			shouldRetryPendingContinuation(
				pendingGoal,
				{ isIdle: () => false, hasPendingMessages: () => false },
				1_000 + CONTINUATION_WATCHDOG_MS,
			),
		).toBe(false);
		expect(
			shouldRetryPendingContinuation(
				pendingGoal,
				{ isIdle: () => true, hasPendingMessages: () => true },
				1_000 + CONTINUATION_WATCHDOG_MS,
			),
		).toBe(false);
	});

	it("backs off stale retries and pauses at the delivery limit", () => {
		const firstAttempt = {
			...goal,
			continuationPendingAt: 1_000,
			continuationAttempt: 1,
		};
		const secondAttempt = { ...firstAttempt, continuationAttempt: 2 };
		const exhausted = {
			...firstAttempt,
			continuationAttempt: MAX_CONTINUATION_DELIVERY_ATTEMPTS,
		};
		const idle = { isIdle: () => true, hasPendingMessages: () => false };

		expect(
			shouldRetryPendingContinuation(
				firstAttempt,
				idle,
				1_000 + CONTINUATION_WATCHDOG_MS,
			),
		).toBe(true);
		expect(
			shouldRetryPendingContinuation(
				secondAttempt,
				idle,
				1_000 + CONTINUATION_WATCHDOG_MS,
			),
		).toBe(false);
		expect(
			shouldRetryPendingContinuation(
				secondAttempt,
				idle,
				1_000 + CONTINUATION_WATCHDOG_MS * 2,
			),
		).toBe(true);
		expect(
			shouldRetryPendingContinuation(
				exhausted,
				idle,
				1_000 + CONTINUATION_WATCHDOG_MS * 4,
			),
		).toBe(false);
		expect(
			shouldPauseForContinuationDeliveryFailure(
				exhausted,
				idle,
				1_000 + CONTINUATION_WATCHDOG_MS * 4,
			),
		).toBe(true);
	});
});

describe("queueGoalContinuation", () => {
	it("persists a pending marker before sending a message", () => {
		const appendEntry = vi.fn();
		const sendUserMessage = vi.fn();
		const ctx = makeCtx({
			isIdle: () => true,
			hasPendingMessages: () => false,
		});

		expect(
			queueGoalContinuation({
				ports: makePorts(appendEntry, sendUserMessage, ctx),
				ctx,
				guard: { queuedGoalId: null },
				goal,
				prompt: "continue",
			}),
		).toBe(true);

		expect(appendEntry).toHaveBeenCalledWith(
			"thread-goal-state",
			expect.objectContaining({
				event: expect.objectContaining({
					action: "continuation",
					pending: true,
				}),
			}),
		);
		expect(sendUserMessage).toHaveBeenCalledWith("continue");
	});

	it("does not send a continuation when the pending marker was not persisted", () => {
		const guard = { queuedGoalId: null };
		const sendUserMessage = vi.fn();
		const ctx = makeCtx({
			isIdle: () => true,
			hasPendingMessages: () => false,
		});

		expect(
			queueGoalContinuation({
				ports: {
					store: {
						markPending: () => null,
						markSent: () => null,
						markFailed: () => null,
					},
					queue: { send: sendUserMessage },
					notifier: { notify: ctx.ui?.notify },
				},
				ctx,
				guard,
				goal,
				prompt: "continue",
			}),
		).toBe(false);

		expect(sendUserMessage).not.toHaveBeenCalled();
		expect(guard.queuedGoalId).toBeNull();
		expect(ctx.ui?.notify).toHaveBeenCalledWith(
			"Goal continuation could not be queued because pending state was not persisted.",
			"warning",
		);
	});

	it("returns false and clears the in-memory guard when sending fails", () => {
		const guard = { queuedGoalId: null };
		const ctx = makeCtx({
			isIdle: () => true,
			hasPendingMessages: () => false,
		});
		const sendUserMessage = vi.fn(() => {
			throw new Error("boom");
		});

		expect(
			queueGoalContinuation({
				ports: makePorts(vi.fn(), sendUserMessage, ctx),
				ctx,
				guard,
				goal,
				prompt: "continue",
			}),
		).toBe(false);
		expect(guard.queuedGoalId).toBeNull();
		expect(ctx.ui?.notify).toHaveBeenCalledWith(
			expect.stringContaining("boom"),
			"warning",
		);
	});

	it("does not throw when sent-state persistence fails after delivery", () => {
		const ctx = makeCtx({
			isIdle: () => true,
			hasPendingMessages: () => false,
		});
		const sendUserMessage = vi.fn();

		expect(
			queueGoalContinuation({
				ports: {
					store: {
						markPending: () => goal,
						markSent: () => {
							throw new Error("sent persist failed");
						},
						markFailed: () => null,
					},
					queue: { send: sendUserMessage },
					notifier: { notify: ctx.ui?.notify },
				},
				ctx,
				guard: { queuedGoalId: null },
				goal,
				prompt: "continue",
			}),
		).toBe(true);

		expect(sendUserMessage).toHaveBeenCalledWith("continue", "immediate");
		expect(ctx.ui?.notify).toHaveBeenCalledWith(
			expect.stringContaining("sent state could not be persisted"),
			"warning",
		);
	});

	it("does not throw when failed-state persistence fails after send failure", () => {
		const ctx = makeCtx({
			isIdle: () => true,
			hasPendingMessages: () => false,
		});
		const sendUserMessage = vi.fn(() => {
			throw new Error("send failed");
		});

		expect(
			queueGoalContinuation({
				ports: {
					store: {
						markPending: () => goal,
						markSent: () => null,
						markFailed: () => {
							throw new Error("failed persist failed");
						},
					},
					queue: { send: sendUserMessage },
					notifier: { notify: ctx.ui?.notify },
				},
				ctx,
				guard: { queuedGoalId: null },
				goal,
				prompt: "continue",
			}),
		).toBe(false);

		expect(ctx.ui?.notify).toHaveBeenCalledWith(
			expect.stringContaining("failed state could not be persisted"),
			"warning",
		);
		expect(ctx.ui?.notify).toHaveBeenCalledWith(
			expect.stringContaining("send failed"),
			"warning",
		);
	});
});

function makePorts(
	appendEntry: (customType: string, data?: unknown) => void,
	sendUserMessage: (
		prompt: string,
		options?: { deliverAs: "followUp" },
	) => void,
	ctx: GoalRuntimeContext,
) {
	return {
		store: {
			markPending(goal: GoalState, reason: string) {
				appendEntry("thread-goal-state", {
					event: {
						action: "continuation",
						goalId: goal.goalId,
						pending: true,
						phase: "queued",
						reason,
					},
				});
				return {
					...goal,
					continuationPendingAt: Date.now(),
					continuationPhase: "queued" as const,
					continuationReason: reason,
					continuationAttempt: (goal.continuationAttempt ?? 0) + 1,
				};
			},
			markSent(goal: GoalState, options: { mode: "immediate" | "followUp" }) {
				appendEntry("thread-goal-state", {
					event: {
						action: "continuation",
						goalId: goal.goalId,
						pending: true,
						phase: "sent",
						mode: options.mode,
					},
				});
				return { ...goal, continuationPhase: "sent" as const };
			},
			markFailed(goal: GoalState, options: { error: string }) {
				appendEntry("thread-goal-state", {
					event: {
						action: "continuation",
						goalId: goal.goalId,
						pending: true,
						phase: "failed",
						error: options.error,
					},
				});
				return { ...goal, continuationPhase: "failed" as const };
			},
		},
		queue: {
			send(prompt: string, mode: "immediate" | "followUp") {
				if (mode === "immediate") sendUserMessage(prompt);
				else sendUserMessage(prompt, { deliverAs: "followUp" });
			},
		},
		notifier: { notify: ctx.ui?.notify },
	};
}

function makeCtx(
	overrides: Pick<GoalRuntimeContext, "isIdle" | "hasPendingMessages">,
): GoalRuntimeContext {
	return {
		sessionManager: { getBranch: () => [] },
		modelRegistry: {
			find: () => undefined,
			getApiKeyAndHeaders: async () => ({ ok: false }),
		},
		ui: { notify: vi.fn() },
		...overrides,
	};
}
