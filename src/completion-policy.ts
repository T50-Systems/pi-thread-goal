import type { GoalState } from "./types.js";

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
