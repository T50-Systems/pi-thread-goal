import { canAutoResumeGoal } from "./goal-state-machine.js";
import {
	GOAL_CONTEXT_CUSTOM_TYPE,
	GOAL_PAUSED_CONTEXT_CUSTOM_TYPE,
} from "./prompts.js";
import type { GoalState } from "./types.js";
import type {
	CompactionResumeEvent,
	ContextMessage,
	RuntimeIdleContext,
} from "./runtime-types.js";

export function filterGoalContextMessages<T extends ContextMessage>(
	messages: T[],
	goal: GoalState | null,
): T[] {
	const expectedCustomType = resolveGoalContextCustomType(goal);
	const expectedGoalId = expectedCustomType ? goal?.goalId : undefined;
	let lastCurrentContextIndex = -1;

	if (expectedCustomType && expectedGoalId) {
		messages.forEach((message, index) => {
			if (
				isGoalContextMessage(message) &&
				message.customType === expectedCustomType &&
				messageHasGoalId(message, expectedGoalId)
			) {
				lastCurrentContextIndex = index;
			}
		});
	}

	return messages.filter((message, index) => {
		if (!isGoalContextMessage(message)) return true;
		if (!expectedCustomType || !expectedGoalId) return false;
		return (
			index === lastCurrentContextIndex &&
			message.customType === expectedCustomType &&
			messageHasGoalId(message, expectedGoalId)
		);
	});
}

export function shouldResumeGoalAfterCompaction(
	goal: GoalState | null,
	event: CompactionResumeEvent,
	ctx: RuntimeIdleContext,
): goal is GoalState {
	if (!canAutoResumeGoal(goal)) return false;
	if (event.willRetry) return false;
	if (ctx.hasPendingMessages?.() === true) return false;

	const isIdle = ctx.isIdle?.();
	if (event.reason === "manual") {
		return isIdle === true;
	}

	return isIdle === true;
}

function resolveGoalContextCustomType(
	goal: GoalState | null,
): string | undefined {
	if (goal === null) return undefined;
	if (goal.status === "active") return GOAL_CONTEXT_CUSTOM_TYPE;
	if (goal.status === "paused") return GOAL_PAUSED_CONTEXT_CUSTOM_TYPE;
	return undefined;
}

function isGoalContextMessage(message: ContextMessage): boolean {
	return (
		message.customType === GOAL_CONTEXT_CUSTOM_TYPE ||
		message.customType === GOAL_PAUSED_CONTEXT_CUSTOM_TYPE
	);
}

function messageHasGoalId(message: ContextMessage, goalId: string): boolean {
	const details = message.details;
	return isRecord(details) && details.goalId === goalId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
