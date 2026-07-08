import { describe, expect, it, vi } from "vitest";
import { createContinuationGuard } from "../src/continuation.js";
import { requireGoalProtocolContext } from "../src/goal-protocol.js";
import {
	type GoalSessionEntry,
	loadGoalState,
	saveGoalState,
} from "../src/goal-state-persistence.js";
import type { GoalRuntimeServices } from "../src/runtime-actions.js";
import {
	handleAgentEndWithLock,
	handleBeforeAgentStart,
	handleContext,
	handleSessionStart,
} from "../src/runtime-mode-handlers.js";
import type {
	GoalRuntimeContext,
	RuntimeExtensionAPI,
} from "../src/runtime-types.js";
import type { GoalEvent } from "../src/types.js";

const completeMock = vi.hoisted(() => vi.fn());

vi.mock("@earendil-works/pi-ai/compat", () => ({
	complete: completeMock,
}));

describe("runtime mode handlers", () => {
	it("clears stale pending continuation before injecting goal context", async () => {
		const harness = createHarness();
		const active = seedGoal(harness.branch);
		saveGoalState(
			harness.runtimePi,
			{
				action: "continuation",
				goalId: active.goalId,
				now: 2,
				pending: true,
				reason: "stale",
			},
			active,
		);

		const result = await handleBeforeAgentStart(harness.services);

		expect(result?.message.details.goalId).toBe(active.goalId);
		expect(result?.message.content).not.toContain("Observation token:");
		expect(result?.message.details.capability?.observed).toBe(true);
		expect(result?.message.content).toContain("Revision:");
		expect(
			loadGoalState(harness.runtimeCtx)?.continuationPendingAt,
		).toBeUndefined();
	});

	it("injects paused-goal guard context instead of active context", async () => {
		const harness = createHarness();
		const active = seedGoal(harness.branch);
		saveGoalState(
			harness.runtimePi,
			{ action: "pause", goalId: active.goalId, now: 2 },
			active,
		);

		const result = await handleBeforeAgentStart(harness.services);

		expect(result?.message.customType).toBe("thread-goal-paused-context");
		expect(result?.message.content).toContain("Status: paused");
		expect(result?.message.content).toContain(
			"Ignore any stale queued continuation",
		);
	});

	it("queues an immediate continuation when resuming an idle active goal", async () => {
		const harness = createHarness({ isIdle: true, hasPendingMessages: false });
		seedGoal(harness.branch);

		await handleSessionStart(harness.services, { reason: "resume" });

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.options).toBeUndefined();
		expect(loadGoalState(harness.runtimeCtx)?.continuationPendingAt).toEqual(
			expect.any(Number),
		);
	});

	it("retries stale pending continuations from the context hook", async () => {
		const harness = createHarness({ isIdle: true, hasPendingMessages: false });
		const active = seedGoal(harness.branch);
		saveGoalState(
			harness.runtimePi,
			{
				action: "continuation",
				goalId: active.goalId,
				now: 2,
				pending: true,
				reason: "stale",
			},
			active,
		);

		await handleContext({ messages: [] }, harness.services);

		expect(harness.sentMessages).toHaveLength(1);
		expect(loadGoalState(harness.runtimeCtx)?.continuationAttempt).toBe(2);
		expect(harness.sentMessages[0]?.options).toEqual({ deliverAs: "followUp" });
	});

	it("queues checkpoint-specific continuation when an unmet turn only reports status", async () => {
		completeMock.mockResolvedValueOnce({
			content: [
				{ type: "text", text: '{"met":false,"reason":"Roadmap remains."}' },
			],
		});
		const harness = createHarness();
		seedGoal(harness.branch);
		harness.runtimeCtx.model = { provider: "custom", id: "model" };
		harness.runtimeCtx.modelRegistry.getApiKeyAndHeaders = async () => ({
			ok: true,
			apiKey: "test-key",
		});
		const lock = { evaluatingGoalId: null as string | null };

		await handleAgentEndWithLock(
			harness.services,
			{
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "text",
								text: "Sub-bloque terminado, tests OK. No marqué el goal como completo porque quedan pendientes del roadmap.",
							},
						],
					},
				],
			},
			lock,
		);

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.prompt).toContain(
			"Previous turn was checkpoint-only while goal remains unmet",
		);
		expect(loadGoalState(harness.runtimeCtx)?.continuationReason).toContain(
			"Previous turn was checkpoint-only while goal remains unmet",
		);
	});

	it("resets the evaluator lock when agent-end evaluation pauses the goal", async () => {
		const harness = createHarness();
		seedGoal(harness.branch);
		const lock = { evaluatingGoalId: null as string | null };

		await handleAgentEndWithLock(harness.services, { messages: [] }, lock);

		expect(lock.evaluatingGoalId).toBeNull();
		expect(loadGoalState(harness.runtimeCtx)?.status).toBe("paused");
		expect(harness.notifications.at(-1)?.message).toContain("Goal paused");
	});
	it("skips stale evaluator results when goal revision changes during evaluation", async () => {
		const harness = createHarness();
		const active = seedGoal(harness.branch);
		harness.runtimeCtx.model = { provider: "custom", id: "model" };
		harness.runtimeCtx.modelRegistry.getApiKeyAndHeaders = async () => {
			saveGoalState(
				harness.runtimePi,
				{
					action: "progress",
					goalId: active.goalId,
					now: 2,
					progress: { summary: "mutated while evaluator awaited" },
				},
				active,
			);
			return { ok: false, error: "auth unavailable" };
		};
		const lock = { evaluatingGoalId: null as string | null };

		await handleAgentEndWithLock(harness.services, { messages: [] }, lock);

		expect(
			harness.branch.filter(
				(entry) =>
					(entry.data as { action?: string } | undefined)?.action ===
					"evaluation",
			),
		).toHaveLength(0);
		expect(loadGoalState(harness.runtimeCtx)?.progress.summary).toBe(
			"mutated while evaluator awaited",
		);
		expect(harness.notifications.at(-1)?.message).toContain(
			"Skipped stale goal evaluation",
		);
	});
});

function createHarness(
	options: { isIdle?: boolean; hasPendingMessages?: boolean } = {},
) {
	const branch: GoalSessionEntry[] = [];
	const sentMessages: Array<{
		prompt: string;
		options?: { deliverAs: "followUp" };
	}> = [];
	const notifications: Array<{
		message: string;
		level?: "info" | "warning" | "error";
	}> = [];
	const runtimePi = {
		on() {},
		appendEntry(customType: string, data?: unknown) {
			branch.push({ type: "custom", customType, data });
		},
		sendUserMessage(
			prompt: string,
			messageOptions?: { deliverAs: "followUp" },
		) {
			sentMessages.push({ prompt, options: messageOptions });
		},
	} satisfies RuntimeExtensionAPI;
	const runtimeCtx: GoalRuntimeContext = {
		sessionManager: {
			getBranch: () => branch,
			sessionId: "test-session",
			leafId: "test-leaf",
		},
		modelRegistry: {
			find: () => undefined,
			getApiKeyAndHeaders: async () => ({ ok: false }),
		},
		isIdle: () => options.isIdle ?? true,
		hasPendingMessages: () => options.hasPendingMessages ?? false,
		ui: {
			notify(message, level) {
				notifications.push({ message, level });
			},
			setStatus() {},
			setWidget() {},
		},
	};
	const services: GoalRuntimeServices = {
		runtimePi,
		runtimeCtx,
		protocolContext: requireGoalProtocolContext(runtimeCtx),
		continuationGuard: createContinuationGuard(),
	};
	return {
		branch,
		notifications,
		runtimeCtx,
		runtimePi,
		sentMessages,
		services,
	};
}

function seedGoal(branch: GoalSessionEntry[]) {
	const pi = {
		appendEntry(customType: string, data?: unknown) {
			branch.push({ type: "custom", customType, data });
		},
	};
	const event: Extract<GoalEvent, { action: "create" }> = {
		action: "create",
		goalId: "g1",
		now: 1,
		objective: "ship clean code",
	};
	const goal = saveGoalState(pi, event, null);
	if (!goal) throw new Error("Expected seeded goal state.");
	return goal;
}
