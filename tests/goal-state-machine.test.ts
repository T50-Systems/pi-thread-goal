import { describe, expect, it } from "vitest";
import {
	canAutoResumeGoal,
	canQueueGoalContinuation,
	decideGoalTransition,
} from "../src/goal-state-machine.js";
import type { GoalEvent, GoalState } from "../src/types.js";

const activeGoal: GoalState = {
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

const pausedGoal: GoalState = {
	...activeGoal,
	status: "paused",
	pauseReason: "manual",
};

const completeGoal: GoalState = {
	...activeGoal,
	status: "complete",
	completedAt: 2,
};

describe("goal state machine transition decisions", () => {
	it.each([
		{
			name: "allows creating into an empty slot",
			current: null,
			event: { action: "create", goalId: "g1", objective: "ship", now: 1 },
			intent: {},
			expected: true,
		},
		{
			name: "rejects creating over an existing goal",
			current: activeGoal,
			event: { action: "create", goalId: "g2", objective: "new", now: 2 },
			intent: {},
			expected: false,
		},
		{
			name: "allows pausing active goals",
			current: activeGoal,
			event: { action: "pause", goalId: "g1", now: 2 },
			intent: {},
			expected: true,
		},
		{
			name: "rejects continuation while paused",
			current: pausedGoal,
			event: { action: "continuation", goalId: "g1", now: 2, pending: true },
			intent: {},
			expected: false,
		},
		{
			name: "rejects progress while complete",
			current: completeGoal,
			event: {
				action: "progress",
				goalId: "g1",
				now: 2,
				progress: { summary: "stale" },
			},
			intent: {},
			expected: false,
		},
		{
			name: "rejects stale events for old goal ids",
			current: activeGoal,
			event: {
				action: "progress",
				goalId: "old",
				now: 2,
				progress: { summary: "stale" },
			},
			intent: {},
			expected: false,
		},
	] satisfies Array<{
		name: string;
		current: GoalState | null;
		event: GoalEvent;
		intent: Parameters<typeof decideGoalTransition>[2];
		expected: boolean;
	}>)("$name", ({ current, event, intent, expected }) => {
		expect(decideGoalTransition(current, event, intent).allowed).toBe(expected);
	});

	it("requires explicit user intent to resume a paused goal for new events", () => {
		const event: GoalEvent = { action: "resume", goalId: "g1", now: 3 };

		expect(
			decideGoalTransition(pausedGoal, event, {
				source: "runtime",
				explicitUserIntent: false,
			}).allowed,
		).toBe(false);
		expect(
			decideGoalTransition(pausedGoal, event, {
				source: "user-command",
				explicitUserIntent: true,
			}).allowed,
		).toBe(true);
	});

	it("keeps legacy replay permissive for historical resume events", () => {
		expect(
			decideGoalTransition(pausedGoal, {
				action: "resume",
				goalId: "g1",
				now: 3,
			}).allowed,
		).toBe(true);
	});
});

describe("goal state machine runtime guards", () => {
	it("allows auto continuation only for active goals", () => {
		expect(canQueueGoalContinuation(activeGoal)).toBe(true);
		expect(canQueueGoalContinuation(pausedGoal)).toBe(false);
		expect(canQueueGoalContinuation(completeGoal)).toBe(false);
		expect(canQueueGoalContinuation(null)).toBe(false);
	});

	it("allows auto resume only for active goals", () => {
		expect(canAutoResumeGoal(activeGoal)).toBe(true);
		expect(canAutoResumeGoal(pausedGoal)).toBe(false);
		expect(canAutoResumeGoal(completeGoal)).toBe(false);
		expect(canAutoResumeGoal(null)).toBe(false);
	});
});
