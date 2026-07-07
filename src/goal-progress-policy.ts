import { normalizeProgress } from "./goal-state-normalizers.js";
import type { GoalProgress } from "./types.js";

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
