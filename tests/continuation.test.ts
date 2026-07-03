import { describe, expect, it, vi } from "vitest";
import {
	clearQueuedGoalContinuation,
	CONTINUATION_WATCHDOG_MS,
	queueGoalContinuation,
	shouldQueueGoalContinuation,
	shouldResumeGoalAfterSessionStart,
	shouldRetryPendingContinuation,
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
					store: { markPending: () => false },
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
						reason,
					},
				});
				return true;
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
