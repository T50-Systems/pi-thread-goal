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

export type ProgressBlockerClassification =
	| "operational"
	| "risk"
	| "uncertainty";

const OPERATIONAL_BLOCKER_PATTERN =
	/\b(waiting|blocked by|need(?:s|ed)? (?:user|decision|approval|credential|secret|token|access|permission|external)|requires? (?:user|decision|approval|credential|secret|token|access|permission|external)|missing (?:credential|secret|token|access|permission)|unavailable|outage|rate limit|no offline path)\b/i;

const RISK_BLOCKER_PATTERN =
	/\b(likely|probably|risk|may need|might need|needs? (?:a )?(?:shaping engine|harfbuzz|dependency|library|refactor)|complex|hard|difficult|uncertain|unknown|investigate|research|explore|spike|technical debt|limitation)\b/i;

export function classifyProgressBlocker(
	text: string,
): ProgressBlockerClassification {
	const normalized = text.trim();
	if (OPERATIONAL_BLOCKER_PATTERN.test(normalized)) return "operational";
	if (RISK_BLOCKER_PATTERN.test(normalized)) {
		return /\b(uncertain|unknown|investigate|research|explore|spike)\b/i.test(
			normalized,
		)
			? "uncertainty"
			: "risk";
	}
	return "operational";
}

export function hasOnlyNonOperationalBlockers(blocked: string[]): boolean {
	return (
		blocked.length > 0 &&
		blocked.every((item) => classifyProgressBlocker(item) !== "operational")
	);
}

export function getNonOperationalBlockers(blocked: string[]): string[] {
	return blocked.filter(
		(item) => classifyProgressBlocker(item) !== "operational",
	);
}

export function isCheckpointOnlyStop(text: string): boolean {
	const normalized = text.toLowerCase();
	if (!normalized.trim()) return false;
	const mentionsProgress =
		/\b(complet|termin|done|finished|implemented|verified|validated|passed|tests? ok|build ok|green)\b/i.test(
			normalized,
		);
	const mentionsStatus =
		/\b(status|summary|resumen|checkpoint|reporte|report|worklog|no marqué|not mark(?:ed)?|no complete|not complete)\b/i.test(
			normalized,
		);
	const mentionsRemaining =
		/\b(remain|remaining|pendiente|pendientes|quedan|roadmap|backlog|next unfinished|siguiente pendiente|next item|not done|aún quedan|still)\b/i.test(
			normalized,
		);

	return (
		(mentionsProgress && mentionsRemaining) ||
		(mentionsStatus && mentionsRemaining)
	);
}

export function buildContinuationReason(
	goal: GoalState,
	decision: EvaluatorDecision,
	agentText: string,
): string {
	const reason = normalizeDecisionReason(decision);
	const notes: string[] = [];
	if (!decision.met && isCheckpointOnlyStop(agentText)) {
		notes.push(
			"Previous turn was checkpoint-only while goal remains unmet; continue with the next unfinished item.",
		);
	}
	if (!decision.met && hasOnlyNonOperationalBlockers(goal.progress.blocked)) {
		notes.push(
			"Persisted blockers look like technical risk or actionable uncertainty, not operational blockers; keep them in current/summary and continue with useful work.",
		);
	}
	return notes.length > 0 ? `${notes.join(" ")} Evaluator: ${reason}` : reason;
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
