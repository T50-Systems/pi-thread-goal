import type { GoalEvent, GoalEventMetadata, GoalState } from "./types.js";

export interface GoalTransitionDecision {
	allowed: boolean;
	reason?: string;
}

export type GoalTransitionIntent = GoalEventMetadata;
export type ActiveGoalState = GoalState & { status: "active" };
export type PausedGoalState = GoalState & { status: "paused" };

export function decideGoalTransition(
	current: GoalState | null,
	event: GoalEvent,
	intent: GoalTransitionIntent = {},
): GoalTransitionDecision {
	const resolvedIntent = resolveTransitionIntent(event, intent);

	if (event.action === "create") {
		return current === null
			? allow()
			: reject("A goal already exists; create requires an empty goal slot.");
	}

	if (event.action === "replace") return allow();

	if (!isCurrentGoal(current, event.goalId)) {
		return reject("Event does not target the current goal.");
	}

	switch (event.action) {
		case "edit":
			return current.status === "complete"
				? reject("Completed goals cannot be edited.")
				: allow();
		case "pause":
			return current.status === "active"
				? allow()
				: reject("Only active goals can be paused.");
		case "resume":
			if (current.status !== "paused") {
				return reject("Only paused goals can be resumed.");
			}
			if (resolvedIntent.source === undefined) return allowLegacyReplay();
			return resolvedIntent.source === "user-command" &&
				resolvedIntent.explicitUserIntent === true
				? allow()
				: reject("Paused goals require explicit user resume intent.");
		case "clear":
		case "dismiss":
			return allow();
		case "complete":
		case "progress":
		case "evaluation":
		case "continuation":
			return current.status === "active"
				? allow()
				: reject(`${event.action} requires an active goal.`);
		default:
			return reject("Unknown goal event action.");
	}
}

export function canQueueGoalContinuation(
	goal: GoalState | null,
): goal is ActiveGoalState {
	return isGoalActive(goal);
}

export function canAutoResumeGoal(
	goal: GoalState | null,
): goal is ActiveGoalState {
	return isGoalActive(goal);
}

export function isGoalActive(goal: GoalState | null): goal is ActiveGoalState {
	return goal !== null && goal.status === "active";
}

export function isGoalPaused(goal: GoalState | null): goal is PausedGoalState {
	return goal !== null && goal.status === "paused";
}

export function resolveTransitionIntent(
	event: GoalEvent,
	intent: GoalTransitionIntent,
): GoalTransitionIntent {
	return {
		...intent,
		source: intent.source ?? event.source,
		explicitUserIntent: intent.explicitUserIntent ?? event.explicitUserIntent,
		causedBy: intent.causedBy ?? event.causedBy,
	};
}

function isCurrentGoal(
	current: GoalState | null,
	goalId: string,
): current is GoalState {
	return current !== null && current.goalId === goalId;
}

function allow(): GoalTransitionDecision {
	return { allowed: true };
}

function allowLegacyReplay(): GoalTransitionDecision {
	return { allowed: true, reason: "Allowed for legacy event replay." };
}

function reject(reason: string): GoalTransitionDecision {
	return { allowed: false, reason };
}
