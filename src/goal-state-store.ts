import {
	createGoalStateSnapshot,
	GOAL_CUSTOM_TYPE,
	toGoalStateEntry,
	type GoalSessionEntry,
} from "./goal-state-snapshot.js";
import type { GoalEvent, GoalState } from "./types.js";

export { GOAL_CUSTOM_TYPE };
export type { GoalSessionEntry };

export interface GoalSessionContext {
	sessionManager: {
		getBranch(): GoalSessionEntry[];
	};
}

export interface GoalAppendAPI {
	appendEntry(customType: string, data?: unknown): unknown;
}

export function saveGoalState(
	pi: GoalAppendAPI,
	event: GoalEvent,
	current: GoalState | null,
): GoalState | null {
	const entry = toGoalStateEntry(event, current);
	pi.appendEntry(GOAL_CUSTOM_TYPE, entry);
	return entry.state;
}

export function loadGoalState(ctx: GoalSessionContext): GoalState | null {
	return createGoalStateSnapshot(ctx.sessionManager.getBranch()).current;
}
