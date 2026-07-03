import type { GoalEvent, GoalState } from "./types.js";
import {
	createGoalState,
	emptyUsage,
	mergeUsage,
	normalizeList,
	normalizeProgress,
	normalizeText,
	normalizeTokenBudget,
	validateObjective,
} from "./goal-state-normalizers.js";
import {
	decideGoalTransition,
	resolveTransitionIntent,
	type GoalTransitionIntent,
} from "./goal-transition-policy.js";

export {
	createGoalState,
	GoalStateValidationError,
	MAX_OBJECTIVE_LENGTH,
	validateObjective,
} from "./goal-state-normalizers.js";
export {
	canAutoResumeGoal,
	canQueueGoalContinuation,
	decideGoalTransition,
	isGoalActive,
	isGoalPaused,
	type ActiveGoalState,
	type GoalTransitionDecision,
	type GoalTransitionIntent,
	type PausedGoalState,
} from "./goal-transition-policy.js";

export function reduceGoalStateMachine(
	current: GoalState | null,
	event: GoalEvent,
	intent: GoalTransitionIntent = {},
): GoalState | null {
	const resolvedIntent = resolveTransitionIntent(event, intent);
	const decision = decideGoalTransition(current, event, resolvedIntent);
	if (!decision.allowed) return current;

	switch (event.action) {
		case "create":
			return current ?? createGoalState(event);
		case "replace":
			return createGoalState(event);
		case "edit": {
			if (!current) return current;
			return {
				...current,
				objective:
					event.objective === undefined
						? current.objective
						: validateObjective(event.objective),
				acceptanceCriteria:
					event.acceptanceCriteria === undefined
						? current.acceptanceCriteria
						: normalizeList(event.acceptanceCriteria),
				sourcePaths:
					event.sourcePaths === undefined
						? current.sourcePaths
						: normalizeList(event.sourcePaths),
				tokenBudget:
					event.tokenBudget === undefined
						? current.tokenBudget
						: normalizeTokenBudget(event.tokenBudget),
				updatedAt: event.now,
			};
		}
		case "pause":
			if (!current) return current;
			return {
				...current,
				status: "paused",
				updatedAt: event.now,
				pauseReason: event.reason ?? "manual",
				pauseMessage: normalizeText(event.message),
				continuationPendingAt: undefined,
				continuationReason: undefined,
			};
		case "resume":
			if (!current) return current;
			return {
				...current,
				status: "active",
				updatedAt: event.now,
				runStartedAt: event.now,
				evaluationTurns: 0,
				usage: emptyUsage(),
				pauseReason: undefined,
				pauseMessage: undefined,
				lastEvaluationReason: "Goal resumed.",
			};
		case "clear":
			return null;
		case "complete":
			if (!current) return current;
			return {
				...current,
				status: "complete",
				updatedAt: event.now,
				completedAt: event.now,
				lastEvaluationReason:
					event.evidence?.trim() ||
					current.lastEvaluationReason ||
					"Goal completed.",
				progress: {
					...current.progress,
					summary:
						event.evidence?.trim() ||
						current.progress.summary ||
						"Goal completed.",
					blocked: [],
				},
				continuationPendingAt: undefined,
				continuationReason: undefined,
			};
		case "dismiss":
			return current
				? { ...current, updatedAt: event.now, dismissedAt: event.now }
				: current;
		case "progress":
			return current
				? {
						...current,
						updatedAt: event.now,
						progress: normalizeProgress(event.progress, current.progress),
					}
				: current;
		case "evaluation":
			return current
				? {
						...current,
						updatedAt: event.now,
						evaluationTurns: current.evaluationTurns + 1,
						lastEvaluationReason:
							event.reason.trim() || current.lastEvaluationReason,
						usage: mergeUsage(current.usage, event.usage),
					}
				: current;
		case "continuation":
			if (!current) return current;
			return event.pending
				? {
						...current,
						updatedAt: event.now,
						continuationPendingAt: event.now,
						continuationReason: normalizeText(event.reason),
					}
				: {
						...current,
						updatedAt: event.now,
						continuationPendingAt: undefined,
						continuationReason: undefined,
					};
		default:
			return current;
	}
}
