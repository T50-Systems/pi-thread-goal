import { bench, describe } from "vitest";
import {
	createGoalStateSnapshot,
	GOAL_CUSTOM_TYPE,
	type GoalSessionEntry,
} from "../src/goal-state-persistence.js";
import type { GoalEvent } from "../src/types.js";

function entry(event: GoalEvent): GoalSessionEntry {
	return {
		type: "custom",
		customType: GOAL_CUSTOM_TYPE,
		data: { event },
	};
}

function makeHistory(progressEvents: number): GoalSessionEntry[] {
	const entries: GoalSessionEntry[] = [
		entry({
			action: "create",
			goalId: "benchmark-goal",
			objective: "Measure branch-local state reconstruction",
			now: 1,
		}),
	];
	for (let index = 0; index < progressEvents; index += 1) {
		entries.push(
			entry({
				action: "progress",
				goalId: "benchmark-goal",
				now: index + 2,
				progress: {
					current: `step ${index}`,
					summary: `Completed ${index} benchmark steps`,
				},
			}),
		);
	}
	return entries;
}

const shortHistory = makeHistory(25);
const longHistory = makeHistory(1_000);

describe("goal state reconstruction", () => {
	bench("26 branch entries", () => {
		createGoalStateSnapshot(shortHistory);
	});

	bench("1,001 branch entries", () => {
		createGoalStateSnapshot(longHistory);
	});
});
