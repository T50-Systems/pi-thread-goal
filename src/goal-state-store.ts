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

/**
 * Low-level legacy reducer persistence used for replay-compatible callers.
 * Prefer saveGoalOperation/executeGoalOperation for runtime, tool, and user
 * mutations so goal operation contracts verify metadata and postconditions.
 */
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
