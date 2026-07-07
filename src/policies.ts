import { normalizeProgress } from "./goal-state.js";
import type { EvaluatorDecision, GoalProgress, GoalState } from "./types.js";


export function validateGoalCompletion(
	goal: GoalState,
	evidence: string | undefined,
): { ok: true } | { ok: false; reason: string } {
	const trimmedEvidence = evidence?.trim() ?? "";
	if (goal.status !== "active") {
		return {
			ok: false,
			reason: `Goal is not active; current status is ${goal.status}.`,
		};
	}
	if (goal.progress.blocked.length > 0) {
		return {
			ok: false,
			reason: `Cannot complete goal with unresolved blockers: ${goal.progress.blocked.join("; ")}.`,
		};
	}
	if (trimmedEvidence.length === 0) {
		return { ok: false, reason: "Completion evidence is required." };
	}
	if (
		goal.acceptanceCriteria.length > 0 &&
		!mentionsCompletionEvidence(trimmedEvidence)
	) {
		return {
			ok: false,
			reason:
				"Completion evidence must cite satisfied criteria, tests, validation, or delivered work.",
		};
	}
	if (hasPendingCurrentWork(goal) && !doneMentionsCurrentWork(goal)) {
		return {
			ok: false,
			reason: `Current work still appears pending: ${goal.progress.current}. Update progress before completing.`,
		};
	}
	return { ok: true };
}

function hasPendingCurrentWork(goal: GoalState): boolean {
	const current = goal.progress.current?.toLowerCase() ?? "";
	return /\b(write|implement|fix|investigate|verify|validate|test|review|continue|next|pending|todo|working)\b/.test(
		current,
	);
}

function doneMentionsCurrentWork(goal: GoalState): boolean {
	const current = goal.progress.current?.toLowerCase().trim();
	if (!current) return true;
	return goal.progress.done.some(
		(item) =>
			current.includes(item.toLowerCase()) ||
			item.toLowerCase().includes(current),
	);
}

function mentionsCompletionEvidence(evidence: string): boolean {
	return /\b(done|complete|completed|passed|passes|tests?|validated?|verified?|criteria|implemented|shipped|delivered)\b/i.test(
		evidence,
	);
}


export function validateGoalProgressUpdate(
	current: GoalProgress,
	patch: Partial<GoalProgress>,
): { ok: true; progress: GoalProgress } | { ok: false; reason: string } {
	const supplied = [
		patch.done,
		patch.current,
		patch.blocked,
		patch.summary,
	].some((value) => value !== undefined);
	if (!supplied) {
		return {
			ok: false,
			reason: "Progress update must include at least one field.",
		};
	}
	const progress = normalizeProgress(patch, current);
	if (sameProgress(current, progress)) {
		return {
			ok: false,
			reason: "Progress update did not change goal progress.",
		};
	}
	return { ok: true, progress };
}

function sameProgress(left: GoalProgress, right: GoalProgress): boolean {
	return (
		left.current === right.current &&
		left.summary === right.summary &&
		sameList(left.done, right.done) &&
		sameList(left.blocked, right.blocked)
	);
}

function sameList(left: string[], right: string[]): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}


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
