import { describe, expect, it, vi } from "vitest";
import { createContinuationGuard } from "../src/continuation.js";
import { requireGoalProtocolContext } from "../src/goal-protocol.js";
import {
	type GoalSessionEntry,
	loadGoalState,
	saveGoalState,
} from "../src/goal-state-persistence.js";
import {
	applyGoalAction,
	ensureGoalStateInvariant,
	type GoalRuntimeServices,
	handleEvaluatorError,
} from "../src/runtime-actions.js";
import type {
	GoalRuntimeContext,
	RuntimeExtensionAPI,
} from "../src/runtime-types.js";

function createHarness(
	options: { isIdle?: boolean; hasPendingMessages?: boolean } = {},
) {
	const branch: GoalSessionEntry[] = [];
	const sentMessages: string[] = [];
	const notify = vi.fn();
	const runtimePi = {
		on() {},
		appendEntry(customType: string, data?: unknown) {
			branch.push({ type: "custom", customType, data });
		},
		sendUserMessage(prompt: string) {
			sentMessages.push(prompt);
		},
	} satisfies RuntimeExtensionAPI;
	const runtimeCtx: GoalRuntimeContext = {
		sessionManager: {
			getBranch: () => branch,
			sessionId: "runtime-actions-session",
			leafId: "runtime-actions-leaf",
		},
		modelRegistry: {
			find: () => undefined,
			getApiKeyAndHeaders: async () => ({ ok: false }),
		},
		isIdle: () => options.isIdle ?? true,
		hasPendingMessages: () => options.hasPendingMessages ?? false,
		ui: {
			notify,
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
	const goal = saveGoalState(
		runtimePi,
		{
			action: "create",
			goalId: "runtime-goal",
			objective: "Exercise runtime decisions",
			now: 1,
		},
		null,
	);
	if (!goal) throw new Error("Expected seeded goal state.");
	return {
		branch,
		goal,
		notify,
		runtimeCtx,
		runtimePi,
		sentMessages,
		services,
	};
}

describe("runtime actions", () => {
	it("persists evaluator-approved completion and notifies", () => {
		const harness = createHarness();

		applyGoalAction(harness.services, harness.goal, {
			type: "complete",
			reason: "All acceptance criteria passed.",
		});

		expect(loadGoalState(harness.runtimeCtx)).toMatchObject({
			status: "complete",
		});
		expect(harness.notify).toHaveBeenCalledWith(
			"Goal complete: All acceptance criteria passed.",
			"info",
		);
	});

	it.each([
		["pause-error", "error"],
		["pause-token-budget", "token-budget"],
		["pause-turn-limit", "turn-limit"],
	] as const)("persists %s decisions", (type, pauseReason) => {
		const harness = createHarness();

		applyGoalAction(harness.services, harness.goal, {
			type,
			reason: `Paused for ${pauseReason}`,
		});

		expect(loadGoalState(harness.runtimeCtx)).toMatchObject({
			status: "paused",
			pauseReason,
		});
		expect(harness.notify).toHaveBeenCalled();
	});

	it("continues an unmet goal through the Pi message queue", () => {
		const harness = createHarness();

		applyGoalAction(harness.services, harness.goal, {
			type: "continue",
			reason: "One verification step remains.",
		});

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toContain("One verification step remains.");
		expect(loadGoalState(harness.runtimeCtx)?.continuationPendingAt).toEqual(
			expect.any(Number),
		);
	});

	it("rejects duplicate continuation delivery while one is already queued", () => {
		const harness = createHarness();
		const action = {
			type: "continue" as const,
			reason: "A continuation is already pending.",
		};

		applyGoalAction(harness.services, harness.goal, action);
		applyGoalAction(harness.services, harness.goal, action);

		expect(harness.sentMessages).toHaveLength(1);
		expect(loadGoalState(harness.runtimeCtx)?.continuationPendingAt).toEqual(
			expect.any(Number),
		);
	});

	it("recovers from retryable evaluator cancellation by continuing", () => {
		const harness = createHarness();

		handleEvaluatorError(
			harness.runtimePi,
			harness.runtimeCtx,
			harness.services.continuationGuard,
			new Error("Evaluator request timed out"),
		);

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toContain("Evaluator request timed out");
		expect(loadGoalState(harness.runtimeCtx)?.status).toBe("active");
	});

	it("pauses after a non-retryable evaluator failure", () => {
		const harness = createHarness();

		handleEvaluatorError(
			harness.runtimePi,
			harness.runtimeCtx,
			harness.services.continuationGuard,
			new Error("Provider credentials are invalid"),
		);

		expect(harness.sentMessages).toHaveLength(0);
		expect(loadGoalState(harness.runtimeCtx)).toMatchObject({
			status: "paused",
			pauseReason: "error",
		});
		expect(harness.notify).toHaveBeenCalledWith(
			expect.stringContaining("Provider credentials are invalid"),
			"warning",
		);
	});

	it("ignores evaluator errors after the goal is no longer active", () => {
		const harness = createHarness();
		applyGoalAction(harness.services, harness.goal, {
			type: "complete",
			reason: "Done",
		});
		harness.notify.mockClear();

		handleEvaluatorError(
			harness.runtimePi,
			harness.runtimeCtx,
			harness.services.continuationGuard,
			new Error("late timeout"),
		);

		expect(harness.sentMessages).toHaveLength(0);
		expect(harness.notify).not.toHaveBeenCalled();
	});

	it("reports invalid reconstructed state before applying UI side effects", () => {
		const harness = createHarness();
		const invalid = { ...harness.goal, goalId: "" };

		expect(ensureGoalStateInvariant(harness.runtimeCtx, invalid)).toBe(false);
		expect(harness.notify).toHaveBeenCalledWith(
			expect.stringContaining("goalId"),
			"warning",
		);
	});
});
