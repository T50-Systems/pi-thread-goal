import {
	goalProtocolContextKey,
	type GoalProtocolContext,
} from "./goal-protocol-context.js";
import { hashEvidence } from "./goal-protocol-tokens.js";
import type { GoalState } from "./types.js";
import type {
	GoalCompletionCandidateRecord,
	GoalObservationCapabilityRecord,
	GoalProtocolDenyCode,
	GoalProtocolScope,
} from "./goal-protocol-types.js";
import type { GoalProtocolCapabilityRegistry } from "./goal-protocol-tokens.js";

export interface GoalProtocolGuardFailure {
	code: GoalProtocolDenyCode;
	reason: string;
}

export function isActiveGoal(goal: GoalState | null): goal is GoalState {
	return goal?.status === "active";
}

export function requireActiveGoal(
	goal: GoalState | null,
	action: string,
): GoalProtocolGuardFailure | null {
	if (!goal) {
		return {
			code: "no-goal",
			reason: `No goal exists to ${action}. Call get_goal before mutating goal state.`,
		};
	}
	if (goal.status !== "active") {
		return {
			code: "not-active",
			reason: `Goal is not active; current status is ${goal.status}.`,
		};
	}
	return null;
}

export function validateObservationCapability(input: {
	registry: GoalProtocolCapabilityRegistry;
	context: GoalProtocolContext;
	goal: GoalState | null;
	scope: GoalProtocolScope;
	now?: number;
}): GoalObservationCapabilityRecord | GoalProtocolGuardFailure {
	const { registry, context, goal, scope } = input;
	const now = input.now ?? Date.now();
	if (!isActiveGoal(goal)) {
		return (
			requireActiveGoal(goal, scope) ?? {
				code: "not-active",
				reason: "Goal is not active.",
			}
		);
	}
	const record = registry.getObservation(context);
	if (!record) {
		return {
			code: "require-observation",
			reason: "Call get_goal before mutating goal state.",
		};
	}
	if (!record.scopes.includes(scope)) {
		return {
			code: "stale-observation",
			reason: `Observation capability is not valid for ${scope}. Call get_goal again.`,
		};
	}
	if (
		!capabilityMatchesGoal(
			record,
			goal,
			context,
			registry.currentEpoch(context),
			now,
		)
	) {
		return {
			code: "stale-observation",
			reason:
				"Observation capability is stale. Call get_goal again before mutating goal state.",
		};
	}
	return record;
}

export function validateCompletionCandidate(input: {
	registry: GoalProtocolCapabilityRegistry;
	context: GoalProtocolContext;
	goal: GoalState | null;
	evidence: string | undefined;
	now?: number;
}): GoalCompletionCandidateRecord | GoalProtocolGuardFailure {
	const { registry, context, goal } = input;
	const now = input.now ?? Date.now();
	if (!isActiveGoal(goal)) {
		return (
			requireActiveGoal(goal, "complete") ?? {
				code: "not-active",
				reason: "Goal is not active.",
			}
		);
	}
	const record = registry.getCompletionCandidate(context);
	if (!record) {
		return {
			code: "require-completion-candidate",
			reason:
				"Completion requires a fresh completion candidate. Call get_goal, then prepare_goal_completion, then complete_goal.",
		};
	}
	if (
		!capabilityMatchesGoal(
			record,
			goal,
			context,
			registry.currentEpoch(context),
			now,
		)
	) {
		return {
			code: "stale-completion-candidate",
			reason:
				"Completion candidate is stale. Call get_goal, then prepare_goal_completion, then complete_goal again.",
		};
	}
	const evidence = input.evidence?.trim() ?? "";
	if (record.evidenceHash !== hashEvidence(evidence)) {
		return {
			code: "stale-completion-candidate",
			reason:
				"Completion evidence does not match the prepared completion candidate. Call prepare_goal_completion again with the evidence you intend to complete with.",
		};
	}
	return record;
}

function capabilityMatchesGoal(
	record: GoalObservationCapabilityRecord | GoalCompletionCandidateRecord,
	goal: GoalState,
	context: GoalProtocolContext,
	epoch: string,
	now: number,
): boolean {
	const statusMatches = !("status" in record) || record.status === goal.status;
	return (
		record.contextKey === goalProtocolContextKey(context) &&
		record.goalId === goal.goalId &&
		record.revision === goal.revision &&
		statusMatches &&
		record.epoch === epoch &&
		record.expiresAt > now
	);
}
