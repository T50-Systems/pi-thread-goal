import { describe, expect, it, vi } from "vitest";
import {
	buildGoalOperationContract,
	executeGoalOperation,
	saveGoalOperation,
} from "../src/goal-operations.js";
import type { GoalEvent, GoalState } from "../src/types.js";

const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 };

const activeGoal: GoalState = {
	version: 1,
	revision: 1,
	goalId: "g1",
	objective: "ship",
	status: "active",
	acceptanceCriteria: [],
	sourcePaths: [],
	progress: { done: [], blocked: ["x"], summary: "working" },
	createdAt: 1,
	updatedAt: 1,
	runStartedAt: 1,
	evaluationTurns: 2,
	usage,
	lastEvaluationReason: "keep going",
	continuationPendingAt: 2,
	continuationReason: "queued",
};

const pausedGoal: GoalState = {
	...activeGoal,
	status: "paused",
	pauseReason: "manual",
	pauseMessage: "wait",
	continuationPendingAt: undefined,
	continuationReason: undefined,
};

function appendApi() {
	return { appendEntry: vi.fn() };
}

describe("goal operation contracts", () => {
	it("enforces explicit user intent and postconditions for resume", () => {
		const pi = appendApi();
		const event: GoalEvent = {
			action: "resume",
			goalId: "g1",
			now: 5,
			source: "user-command",
			explicitUserIntent: true,
			causedBy: "/goal resume",
		};

		const result = executeGoalOperation({
			pi,
			before: pausedGoal,
			event,
			contract: buildGoalOperationContract(event),
		});

		expect(result.ok).toBe(true);
		expect(result.state?.status).toBe("active");
		expect(result.state?.pauseReason).toBeUndefined();
		expect(result.state?.evaluationTurns).toBe(0);
		expect(result.state?.usage.total).toBe(0);
		expect(pi.appendEntry).toHaveBeenCalledTimes(1);
	});

	it("rejects runtime resume of a paused goal before persistence", () => {
		const pi = appendApi();
		const event: GoalEvent = {
			action: "resume",
			goalId: "g1",
			now: 5,
			source: "runtime",
			explicitUserIntent: false,
			causedBy: "session-start",
		};

		const result = executeGoalOperation({ pi, before: pausedGoal, event });

		expect(result.ok).toBe(false);
		expect(pi.appendEntry).not.toHaveBeenCalled();
	});

	it("requires continuation operations to clear only on active goals", () => {
		const pi = appendApi();
		const event: GoalEvent = {
			action: "continuation",
			goalId: "g1",
			now: 5,
			pending: false,
			source: "runtime",
			explicitUserIntent: false,
			causedBy: "before-agent-start:clear-pending-continuation",
		};

		const result = executeGoalOperation({ pi, before: pausedGoal, event });

		expect(result.ok).toBe(false);
		expect(pi.appendEntry).not.toHaveBeenCalled();
	});

	it("verifies completion clears continuation and blockers", () => {
		const pi = appendApi();
		const event: GoalEvent = {
			action: "complete",
			goalId: "g1",
			now: 5,
			evidence: "done",
			source: "runtime",
			explicitUserIntent: false,
			causedBy: "goal-next-action:complete",
		};

		const next = saveGoalOperation(pi, event, activeGoal);

		expect(next?.status).toBe("complete");
		expect(next?.continuationPendingAt).toBeUndefined();
		expect(next?.progress.blocked).toEqual([]);
	});

	it("rejects mutating events without audit metadata", () => {
		const pi = appendApi();
		const event = {
			action: "progress",
			goalId: "g1",
			now: 5,
			progress: { summary: "updated" },
		} as GoalEvent;

		expect(() => saveGoalOperation(pi, event, activeGoal)).toThrow(
			/requires source metadata/,
		);
		expect(pi.appendEntry).not.toHaveBeenCalled();
	});
});
