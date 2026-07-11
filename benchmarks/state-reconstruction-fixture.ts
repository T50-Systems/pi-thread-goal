import {
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

export function makeGoalHistory(progressEvents: number): GoalSessionEntry[] {
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
