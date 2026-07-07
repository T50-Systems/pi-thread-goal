import { validateGoalCompletion } from "./completion-policy.js";
import {
	isActiveGoal,
	validateCompletionCandidate,
	validateObservationCapability,
} from "./goal-protocol-guards.js";
import type { GoalProtocolContext } from "./goal-protocol-context.js";
import {
	defaultGoalProtocolCapabilities,
	type GoalProtocolCapabilityRegistry,
} from "./goal-protocol-tokens.js";
import {
	protocolStateForGoal,
	type GoalCompletionCandidateRecord,
	type GoalObservationCapabilityRecord,
	type GoalProtocolCapabilitySummary,
	type GoalProtocolDecision,
} from "./goal-protocol-types.js";
import type { GoalState } from "./types.js";

export function observeGoal(input: {
	context: GoalProtocolContext;
	goal: GoalState | null;
	registry?: GoalProtocolCapabilityRegistry;
	now?: number;
}): GoalProtocolDecision<GoalProtocolCapabilitySummary> {
	const registry = input.registry ?? defaultGoalProtocolCapabilities;
	const now = input.now ?? Date.now();
	registry.pruneExpired(now);
	if (!input.goal) {
		return {
			allowed: true,
			state: "observed-no-goal",
			output: "return-no-goal",
			data: { observed: false },
		};
	}
	const state = protocolStateForGoal(input.goal);
	const record = isActiveGoal(input.goal)
		? registry.issueObservation(
				input.context,
				input.goal,
				["progress", "prepare-completion"],
				now,
			)
		: null;
	const summary: GoalProtocolCapabilitySummary = record
		? { observed: true, expiresAt: record.expiresAt }
		: { observed: false };
	return {
		allowed: true,
		state,
		output: input.goal ? "return-observed-goal" : "return-no-goal",
		capability: summary,
		data: summary,
	};
}

export function authorizeProgressUpdate(input: {
	context: GoalProtocolContext;
	goal: GoalState | null;
	registry?: GoalProtocolCapabilityRegistry;
	now?: number;
}): GoalProtocolDecision<GoalObservationCapabilityRecord> {
	const registry = input.registry ?? defaultGoalProtocolCapabilities;
	const now = input.now ?? Date.now();
	registry.pruneExpired(now);
	const validation = validateObservationCapability({
		registry,
		context: input.context,
		goal: input.goal,
		scope: "progress",
		now,
	});
	if ("code" in validation) {
		return {
			allowed: false,
			state: input.goal ? protocolStateForGoal(input.goal) : "unknown",
			output: "deny",
			code: validation.code,
			reason: validation.reason,
		};
	}
	return {
		allowed: true,
		state: "observed-active",
		output: "execute-update-progress",
		capability: { observed: true, expiresAt: validation.expiresAt },
		data: validation,
	};
}

export function prepareGoalCompletion(input: {
	context: GoalProtocolContext;
	goal: GoalState | null;
	evidence: string | undefined;
	registry?: GoalProtocolCapabilityRegistry;
	now?: number;
}): GoalProtocolDecision<GoalProtocolCapabilitySummary> {
	const registry = input.registry ?? defaultGoalProtocolCapabilities;
	const now = input.now ?? Date.now();
	registry.pruneExpired(now);
	const validation = validateObservationCapability({
		registry,
		context: input.context,
		goal: input.goal,
		scope: "prepare-completion",
		now,
	});
	if ("code" in validation) {
		return {
			allowed: false,
			state: input.goal ? protocolStateForGoal(input.goal) : "unknown",
			output: "deny",
			code: validation.code,
			reason: validation.reason,
		};
	}
	if (!input.goal) {
		return {
			allowed: false,
			state: "observed-no-goal",
			output: "deny",
			code: "no-goal",
			reason: "No goal exists to complete. Call get_goal before completing.",
		};
	}
	const completion = validateGoalCompletion(input.goal, input.evidence);
	if (!completion.ok) {
		return {
			allowed: false,
			state: "observed-active",
			output: "deny",
			code: "completion-contradicted",
			reason: completion.reason,
		};
	}
	const evidence = input.evidence?.trim() ?? "";
	const record = registry.issueCompletionCandidate(
		input.context,
		input.goal,
		evidence,
		now,
	);
	const summary: GoalProtocolCapabilitySummary = {
		completionCandidate: true,
		expiresAt: record.expiresAt,
		evidenceHash: record.evidenceHash,
	};
	return {
		allowed: true,
		state: "completion-candidate",
		output: "return-completion-candidate",
		capability: summary,
		data: summary,
	};
}

export function authorizeGoalCompletion(input: {
	context: GoalProtocolContext;
	goal: GoalState | null;
	evidence: string | undefined;
	registry?: GoalProtocolCapabilityRegistry;
	now?: number;
}): GoalProtocolDecision<GoalCompletionCandidateRecord> {
	const registry = input.registry ?? defaultGoalProtocolCapabilities;
	const now = input.now ?? Date.now();
	registry.pruneExpired(now);
	const validation = validateCompletionCandidate({
		registry,
		context: input.context,
		goal: input.goal,
		evidence: input.evidence,
		now,
	});
	if ("code" in validation) {
		return {
			allowed: false,
			state: input.goal ? protocolStateForGoal(input.goal) : "unknown",
			output: "deny",
			code: validation.code,
			reason: validation.reason,
		};
	}
	return {
		allowed: true,
		state: "completion-candidate",
		output: "execute-complete-goal",
		capability: {
			completionCandidate: true,
			expiresAt: validation.expiresAt,
			evidenceHash: validation.evidenceHash,
		},
		data: validation,
	};
}
