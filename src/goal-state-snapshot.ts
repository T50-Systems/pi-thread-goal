import { reduceGoalState } from "./goal-state-reducer.js";
import type { GoalEvent, GoalState, GoalStateEntry, GoalStateSnapshot } from "./types.js";

export const GOAL_CUSTOM_TYPE = "thread-goal-state";

export interface GoalSessionEntry {
	type: string;
	customType?: string;
	data?: unknown;
}

export function toGoalStateEntry(
	event: GoalEvent,
	current: GoalState | null,
): GoalStateEntry {
	return {
		action: event.action,
		state: cloneGoalState(reduceGoalState(current, event)),
		event: cloneEvent(event),
	};
}

export function createGoalStateSnapshot(
	branchEntries: GoalSessionEntry[],
): GoalStateSnapshot {
	let current: GoalState | null = null;
	const entries: GoalStateEntry[] = [];

	for (const branchEntry of branchEntries) {
		if (
			branchEntry.type !== "custom" ||
			branchEntry.customType !== GOAL_CUSTOM_TYPE
		)
			continue;
		const goalEntry = parseGoalStateEntry(branchEntry.data);
		if (!goalEntry) continue;
		current = reduceGoalState(current, goalEntry.event);
		entries.push({ ...goalEntry, state: cloneGoalState(current) });
	}

	return { current: cloneGoalState(current), entries };
}

function parseGoalStateEntry(data: unknown): GoalStateEntry | null {
	if (!isRecord(data) || !isGoalEvent(data.event) || !("action" in data))
		return null;
	return {
		action: data.event.action,
		state: isGoalState(data.state) ? cloneGoalState(data.state) : null,
		event: cloneEvent(data.event),
	};
}

export function cloneGoalState(state: GoalState | null): GoalState | null {
	return state === null
		? null
		: {
				...state,
				acceptanceCriteria: [...state.acceptanceCriteria],
				sourcePaths: [...state.sourcePaths],
				tokenBudget: state.tokenBudget,
				pauseReason: state.pauseReason,
				pauseMessage: state.pauseMessage,
				usage: { ...state.usage },
				progress: {
					done: [...state.progress.done],
					blocked: [...state.progress.blocked],
					current: state.progress.current,
					summary: state.progress.summary,
				},
				dismissedAt: state.dismissedAt,
			};
}

function cloneEvent(event: GoalEvent): GoalEvent {
	return structuredClone(event);
}

function isGoalState(value: unknown): value is GoalState {
	return (
		isRecord(value) &&
		value.version === 1 &&
		typeof value.goalId === "string" &&
		typeof value.objective === "string" &&
		isGoalStatus(value.status)
	);
}

function isGoalEvent(value: unknown): value is GoalEvent {
	return (
		isRecord(value) &&
		typeof value.action === "string" &&
		typeof value.goalId === "string"
	);
}

function isGoalStatus(value: unknown): boolean {
	return value === "active" || value === "paused" || value === "complete";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
