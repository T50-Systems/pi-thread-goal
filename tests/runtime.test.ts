import { describe, expect, it } from "vitest";
import {
	shouldResumeGoalAfterSessionStart,
	shouldRetryPendingContinuation,
} from "../src/continuation.js";
import {
	filterGoalContextMessages,
	shouldResumeGoalAfterCompaction,
} from "../src/runtime.js";
import type { GoalState } from "../src/types.js";

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

describe("filterGoalContextMessages", () => {
	it("keeps only the latest goal context for the active goal", () => {
		const messages = [
			{
				customType: "thread-goal-context",
				details: { goalId: "g1" },
				content: "old",
			},
			{ customType: "other", content: "keep" },
			{
				customType: "thread-goal-context",
				details: { goalId: "g1" },
				content: "new",
			},
		];

		const filtered = filterGoalContextMessages(messages, goal);
		expect(filtered).toHaveLength(2);
		expect(filtered[1]?.content).toBe("new");
	});

	it("keeps only paused context and drops stale active context for a paused goal", () => {
		const pausedGoal: GoalState = {
			...goal,
			status: "paused",
			pauseReason: "manual",
		};
		const messages = [
			{
				customType: "thread-goal-context",
				details: { goalId: "g1" },
				content: "stale active",
			},
			{ customType: "other", content: "keep" },
			{
				customType: "thread-goal-paused-context",
				details: { goalId: "g1" },
				content: "old paused",
			},
			{
				customType: "thread-goal-paused-context",
				details: { goalId: "g1" },
				content: "new paused",
			},
		];

		const filtered = filterGoalContextMessages(messages, pausedGoal);
		expect(filtered).toHaveLength(2);
		expect(filtered[0]?.content).toBe("keep");
		expect(filtered[1]?.content).toBe("new paused");
	});

	it("drops goal contexts when no active goal exists", () => {
		const messages = [
			{
				customType: "thread-goal-context",
				details: { goalId: "g1" },
				content: "old",
			},
		];
		expect(filterGoalContextMessages(messages, null)).toEqual([]);
	});

	it("drops goal contexts when the loaded goal is null", () => {
		const messages = [
			{
				customType: "thread-goal-context",
				details: { goalId: "g1" },
				content: "drop",
			},
			{ customType: "other", content: "keep" },
		];

		expect(filterGoalContextMessages(messages, null)).toEqual([
			{ customType: "other", content: "keep" },
		]);
	});
});

describe("runtime null-safety helpers", () => {
	it("does not resume after compaction without an active goal", () => {
		expect(
			shouldResumeGoalAfterCompaction(
				null,
				{ reason: "manual", willRetry: false },
				{ isIdle: () => true, hasPendingMessages: () => false },
			),
		).toBe(false);
	});

	it("does not resume a session without an active goal", () => {
		expect(
			shouldResumeGoalAfterSessionStart(
				null,
				{ reason: "resume" },
				{ isIdle: () => true, hasPendingMessages: () => false },
			),
		).toBe(false);
	});

	it("does not retry pending continuation without an active goal", () => {
		expect(
			shouldRetryPendingContinuation(null, {
				isIdle: () => true,
				hasPendingMessages: () => false,
			}),
		).toBe(false);
	});
});

describe("shouldResumeGoalAfterCompaction", () => {
	it("continues active goals after manual compaction when idle", () => {
		expect(
			shouldResumeGoalAfterCompaction(
				goal,
				{ reason: "manual", willRetry: false },
				{ isIdle: () => true, hasPendingMessages: () => false },
			),
		).toBe(true);
	});

	it("does not continue after manual compaction when idleness is unknown", () => {
		expect(
			shouldResumeGoalAfterCompaction(
				goal,
				{ reason: "manual", willRetry: false },
				{ hasPendingMessages: () => false },
			),
		).toBe(false);
	});

	it("does not continue when pi will retry the aborted turn", () => {
		expect(
			shouldResumeGoalAfterCompaction(
				goal,
				{ reason: "overflow", willRetry: true },
				{ isIdle: () => true, hasPendingMessages: () => false },
			),
		).toBe(false);
	});

	it("does not inject duplicate continuation over queued messages", () => {
		expect(
			shouldResumeGoalAfterCompaction(
				goal,
				{ reason: "manual", willRetry: false },
				{ isIdle: () => true, hasPendingMessages: () => true },
			),
		).toBe(false);
	});

	it("only resumes threshold compaction when the runtime is already idle", () => {
		expect(
			shouldResumeGoalAfterCompaction(
				goal,
				{ reason: "threshold", willRetry: false },
				{ isIdle: () => false, hasPendingMessages: () => false },
			),
		).toBe(false);
		expect(
			shouldResumeGoalAfterCompaction(
				goal,
				{ reason: "threshold", willRetry: false },
				{ isIdle: () => true, hasPendingMessages: () => false },
			),
		).toBe(true);
	});
});
