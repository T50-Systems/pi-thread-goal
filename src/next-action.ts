import { validateGoalCompletion } from "./completion-policy.js";
import type { EvaluatorDecision, GoalState } from "./types.js";

export const MAX_AUTOMATIC_CONTINUATION_TURNS = 25;

export type GoalNextAction =
	| { type: "complete"; reason: string }
	| { type: "pause-error"; reason: string }
	| { type: "pause-token-budget"; reason: string }
	| { type: "pause-turn-limit"; reason: string }
	| { type: "continue"; reason: string };

export function decideGoalNextAction(
	goal: GoalState,
	decision: EvaluatorDecision,
): GoalNextAction {
	const reason = normalizeDecisionReason(decision);

	if (decision.met) {
		const completion = validateGoalCompletion(goal, reason);
		if (completion.ok) return { type: "complete", reason };
		return decideContinuationOrPause(goal, completion.reason);
	}

	return decideContinuationOrPause(goal, reason);
}

export function hasReachedAutomaticContinuationLimit(goal: GoalState): boolean {
	return (
		goal.status === "active" &&
		goal.evaluationTurns >= MAX_AUTOMATIC_CONTINUATION_TURNS
	);
}

export function hasReachedTokenBudget(goal: GoalState): boolean {
	return (
		goal.status === "active" &&
		typeof goal.tokenBudget === "number" &&
		goal.usage.total >= goal.tokenBudget
	);
}

export function shouldPauseForEvaluatorConfiguration(reason: string): boolean {
	return /no evaluator model|no evaluator api key|evaluator auth failed/i.test(
		reason,
	);
}

function decideContinuationOrPause(
	goal: GoalState,
	reason: string,
): GoalNextAction {
	if (shouldPauseForEvaluatorConfiguration(reason)) {
		return { type: "pause-error", reason };
	}
	if (hasReachedTokenBudget(goal)) {
		return {
			type: "pause-token-budget",
			reason: `Token budget reached (${goal.usage.total}/${goal.tokenBudget}).`,
		};
	}
	if (hasReachedAutomaticContinuationLimit(goal)) {
		return {
			type: "pause-turn-limit",
			reason: `Paused after ${MAX_AUTOMATIC_CONTINUATION_TURNS} evaluator turns without completion.`,
		};
	}
	return { type: "continue", reason };
}

function normalizeDecisionReason(decision: EvaluatorDecision): string {
	return (
		decision.reason.trim() ||
		(decision.met
			? "Goal condition satisfied."
			: "Goal condition not yet satisfied.")
	);
}
