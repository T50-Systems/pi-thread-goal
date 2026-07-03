import { describe, expect, it } from "vitest";
import { createContinuationGuard } from "../src/continuation.js";
import {
	handleAgentEndWithLock,
	handleBeforeAgentStart,
	handleSessionStart,
} from "../src/runtime-mode-handlers.js";
import {
	loadGoalState,
	saveGoalState,
	type GoalSessionEntry,
} from "../src/state.js";
import type { GoalRuntimeServices } from "../src/runtime-actions.js";
import type {
	GoalRuntimeContext,
	RuntimeExtensionAPI,
} from "../src/runtime-types.js";
import type { GoalEvent } from "../src/types.js";

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
		expect(
			loadGoalState(harness.runtimeCtx)?.continuationPendingAt,
		).toBeUndefined();
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

	it("resets the evaluator lock when agent-end evaluation pauses the goal", async () => {
		const harness = createHarness();
		seedGoal(harness.branch);
		const lock = { evaluatingGoalId: null as string | null };

		await handleAgentEndWithLock(harness.services, { messages: [] }, lock);

		expect(lock.evaluatingGoalId).toBeNull();
		expect(loadGoalState(harness.runtimeCtx)?.status).toBe("paused");
		expect(harness.notifications.at(-1)?.message).toContain("Goal paused");
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
		sessionManager: { getBranch: () => branch },
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
