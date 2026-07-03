import { GOAL_CONTEXT_CUSTOM_TYPE } from "./prompts.js";
import type { GoalState } from "./types.js";
import type { CompactionResumeEvent, ContextMessage, RuntimeIdleContext } from "./runtime-types.js";

export function filterGoalContextMessages<T extends ContextMessage>(
	messages: T[],
	goal: GoalState | null,
): T[] {
	const activeGoalId = isActiveGoal(goal) ? goal.goalId : undefined;
	let lastCurrentContextIndex = -1;

	if (activeGoalId) {
		messages.forEach((message, index) => {
			if (
				isGoalContextMessage(message) &&
				messageHasGoalId(message, activeGoalId)
			) {
				lastCurrentContextIndex = index;
			}
		});
	}

	return messages.filter((message, index) => {
		if (!isGoalContextMessage(message)) return true;
		if (!activeGoalId) return false;
		return (
			index === lastCurrentContextIndex &&
			messageHasGoalId(message, activeGoalId)
		);
	});
}

export function shouldResumeGoalAfterCompaction(
	goal: GoalState | null,
	event: CompactionResumeEvent,
	ctx: RuntimeIdleContext,
): goal is GoalState {
	if (!isActiveGoal(goal)) return false;
	if (event.willRetry) return false;
	if (ctx.hasPendingMessages?.() === true) return false;

	const isIdle = ctx.isIdle?.();
	if (event.reason === "manual") {
		return isIdle === true;
	}

	return isIdle === true;
}

function isActiveGoal(goal: GoalState | null): goal is GoalState {
	return goal !== null && goal.status === "active";
}

function isGoalContextMessage(message: ContextMessage): boolean {
	return message.customType === GOAL_CONTEXT_CUSTOM_TYPE;
}

function messageHasGoalId(message: ContextMessage, goalId: string): boolean {
	const details = message.details;
	return isRecord(details) && details.goalId === goalId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
