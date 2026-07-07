import { describe, expect, it } from "vitest";
import { createGoalStateSnapshot, reduceGoalState } from "../src/state.js";
import type { GoalEvent } from "../src/types.js";

function apply(events: GoalEvent[]) {
	let state = null;
	for (const event of events) {
		state = reduceGoalState(state, event);
	}
	return state;
}

describe("goal state", () => {
	it("creates, progresses, pauses, resumes, and completes", () => {
		const state = apply([
			{ action: "create", goalId: "g1", objective: "ship it", now: 1 },
			{
				action: "progress",
				goalId: "g1",
				now: 2,
				progress: { summary: "working", current: "tests" },
			},
			{
				action: "evaluation",
				goalId: "g1",
				now: 3,
				reason: "Need green tests",
				usage: { total: 50 },
			},
			{ action: "pause", goalId: "g1", now: 4 },
			{ action: "resume", goalId: "g1", now: 5 },
			{ action: "complete", goalId: "g1", now: 6, evidence: "tests passed" },
		]);

		expect(state?.status).toBe("complete");
		expect(state?.progress.summary).toBe("tests passed");
		expect(state?.lastEvaluationReason).toBe("tests passed");
	});

	it("preserves token budget and pause reason across lifecycle events", () => {
		const state = apply([
			{
				action: "create",
				goalId: "g1",
				objective: "ship it",
				now: 1,
				tokenBudget: 100_000,
			},
			{
				action: "evaluation",
				goalId: "g1",
				now: 2,
				reason: "Need more work",
				usage: { total: 50_000 },
			},
			{
				action: "pause",
				goalId: "g1",
				now: 3,
				reason: "token-budget",
				message: "budget reached",
			},
		]);

		expect(state?.status).toBe("paused");
		expect(state?.tokenBudget).toBe(100_000);
		expect(state?.pauseReason).toBe("token-budget");
		expect(state?.pauseMessage).toBe("budget reached");
	});

	it("clears pause metadata and resets run usage on resume", () => {
		const state = apply([
			{
				action: "create",
				goalId: "g1",
				objective: "ship it",
				now: 1,
				tokenBudget: 100_000,
			},
			{
				action: "evaluation",
				goalId: "g1",
				now: 2,
				reason: "Need more work",
				usage: { total: 50_000 },
			},
			{
				action: "pause",
				goalId: "g1",
				now: 3,
				reason: "error",
				message: "auth failed",
			},
			{ action: "resume", goalId: "g1", now: 4 },
		]);

		expect(state?.status).toBe("active");
		expect(state?.tokenBudget).toBe(100_000);
		expect(state?.usage.total).toBe(0);
		expect(state?.pauseReason).toBeUndefined();
		expect(state?.pauseMessage).toBeUndefined();
	});

	it("tracks and clears pending continuations", () => {
		const state = apply([
			{ action: "create", goalId: "g1", objective: "ship it", now: 1 },
			{
				action: "continuation",
				goalId: "g1",
				now: 2,
				pending: true,
				reason: "queued",
			},
			{ action: "continuation", goalId: "g1", now: 3, pending: false },
		]);

		expect(state?.continuationPendingAt).toBeUndefined();
		expect(state?.continuationReason).toBeUndefined();
		expect(state?.updatedAt).toBe(3);
	});

	it("dismisses completed goals without clearing state", () => {
		const state = apply([
			{ action: "create", goalId: "g1", objective: "ship it", now: 1 },
			{ action: "complete", goalId: "g1", now: 2, evidence: "done" },
			{ action: "dismiss", goalId: "g1", now: 3 },
		]);

		expect(state?.status).toBe("complete");
		expect(state?.dismissedAt).toBe(3);
		expect(state?.objective).toBe("ship it");
	});

	it("replaces old goals with new ids", () => {
		const state = apply([
			{ action: "create", goalId: "g1", objective: "old", now: 1 },
			{ action: "replace", goalId: "g2", objective: "new", now: 2 },
			{
				action: "progress",
				goalId: "g1",
				now: 3,
				progress: { summary: "stale" },
			},
		]);

		expect(state?.goalId).toBe("g2");
		expect(state?.objective).toBe("new");
		expect(state?.progress.summary).not.toBe("stale");
	});

	it("reconstructs from custom branch entries", () => {
		const snapshot = createGoalStateSnapshot([
			{
				type: "custom",
				customType: "thread-goal-state",
				data: {
					action: "create",
					event: { action: "create", goalId: "g1", objective: "ship", now: 1 },
					state: null,
				},
			},
			{
				type: "custom",
				customType: "thread-goal-state",
				data: {
					action: "progress",
					event: {
						action: "progress",
						goalId: "g1",
						now: 2,
						progress: { summary: "moving" },
					},
					state: null,
				},
			},
		]);

		expect(snapshot.current?.objective).toBe("ship");
		expect(snapshot.current?.progress.summary).toBe("moving");
	});
	it("uses valid stored state as a checkpoint for partial legacy events", () => {
		const stored = reduceGoalState(null, {
			action: "create",
			goalId: "g1",
			objective: "ship",
			now: 1,
		});

		const snapshot = createGoalStateSnapshot([
			{
				type: "custom",
				customType: "thread-goal-state",
				data: {
					action: "create",
					event: { action: "create", goalId: "g1", now: 1 },
					state: stored,
				},
			},
		]);

		expect(snapshot.current?.objective).toBe("ship");
	});

	it("skips malformed events without valid stored state", () => {
		const snapshot = createGoalStateSnapshot([
			{
				type: "custom",
				customType: "thread-goal-state",
				data: {
					action: "create",
					event: { action: "create", goalId: "g1", now: 1 },
					state: null,
				},
			},
		]);

		expect(snapshot.current).toBeNull();
		expect(snapshot.entries).toEqual([]);
	});

	it("does not throw on malformed complete evidence during replay", () => {
		expect(() =>
			createGoalStateSnapshot([
				{
					type: "custom",
					customType: "thread-goal-state",
					data: {
						action: "complete",
						event: { action: "complete", goalId: "g1", now: 1, evidence: 123 },
						state: null,
					},
				},
			]),
		).not.toThrow();
	});
});
