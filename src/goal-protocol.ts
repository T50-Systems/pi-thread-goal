import { createHash, randomUUID } from "node:crypto";
import { validateGoalCompletion } from "./policies.js";
import type { GoalState, GoalStatus } from "./types.js";

export interface GoalProtocolContext {
	sessionId: string;
	branchId: string;
	actorId?: string;
}

export interface GoalProtocolContextSource {
	goalProtocol?: GoalProtocolContext;
	sessionManager?: {
		sessionId?: string;
		leafId?: string | null;
	};
}

export function goalProtocolContextKey(context: GoalProtocolContext): string {
	return JSON.stringify([
		context.sessionId,
		context.branchId,
		context.actorId ?? "default",
	]);
}

export function requireGoalProtocolContext(
	context: GoalProtocolContextSource,
): GoalProtocolContext {
	// Prefer an explicit, host-provided protocol context when present. No
	// shipped Pi host provides one today, but honoring it keeps the door open
	// for a host (or test) that supplies an authoritative sessionId/branchId.
	const explicit = context.goalProtocol;
	if (explicit) {
		if (
			typeof explicit.sessionId !== "string" ||
			explicit.sessionId.trim().length === 0 ||
			typeof explicit.branchId !== "string" ||
			explicit.branchId.trim().length === 0 ||
			(explicit.actorId !== undefined && typeof explicit.actorId !== "string")
		) {
			throw new Error(
				"Goal protocol context is invalid: sessionId and branchId must be non-empty strings.",
			);
		}
		return explicit;
	}

	// Otherwise derive the context from Pi's session manager.
	const sessionId = context.sessionManager?.sessionId;
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
		throw new Error(
			"Goal protocol requires a session id; none was provided by the Pi session manager.",
		);
	}
	// branchId must stay stable across the get_goal -> prepare_goal_completion
	// -> complete_goal handshake, which spans several tool calls within one
	// turn. Pi's sessionManager.leafId advances on every appended entry, so
	// using it here would move the capability key between get_goal and the
	// mutating tool and reject it with "Call get_goal before mutating goal
	// state." Cross-branch isolation does not need the leaf: switching branches
	// fires session_start / session_tree, which resets the protocol epoch, and
	// the capability validation independently checks goalId + revision + epoch.
	// So the session id is both a stable and a safe branch scope.
	return { sessionId, branchId: sessionId };
}

export type GoalProtocolState =
	| "unknown"
	| "observed-no-goal"
	| "observed-active"
	| "observed-paused"
	| "observed-complete"
	| "completion-candidate";

export type GoalProtocolEvent =
	| "get_goal"
	| "update_goal_progress"
	| "prepare_goal_completion"
	| "complete_goal"
	| "external_mutation"
	| "capability_expired"
	| "reset_epoch";

export type GoalProtocolScope = "progress" | "prepare-completion";

export type GoalProtocolDenyCode =
	| "require-observation"
	| "require-completion-candidate"
	| "no-goal"
	| "not-active"
	| "stale-observation"
	| "stale-completion-candidate"
	| "completion-contradicted";

export type GoalProtocolOutput =
	| "return-no-goal"
	| "return-observed-goal"
	| "return-completion-candidate"
	| "execute-update-progress"
	| "execute-complete-goal"
	| "deny";

export interface GoalProtocolContextBinding {
	contextKey: string;
	goalId: string;
	revision: number;
	epoch: string;
	expiresAt: number;
}

export interface GoalObservationCapabilityRecord
	extends GoalProtocolContextBinding {
	type: "observation";
	status: GoalStatus;
	scopes: GoalProtocolScope[];
}

export interface GoalCompletionCandidateRecord
	extends GoalProtocolContextBinding {
	type: "completion-candidate";
	evidenceHash: string;
}

export interface GoalProtocolCapabilitySummary {
	observed?: boolean;
	completionCandidate?: boolean;
	expiresAt?: number;
	evidenceHash?: string;
}

export type GoalProtocolDecision<T = undefined> =
	| {
			allowed: true;
			state: GoalProtocolState;
			output: GoalProtocolOutput;
			capability?: GoalProtocolCapabilitySummary;
			data: T;
	  }
	| {
			allowed: false;
			state: GoalProtocolState;
			output: "deny";
			code: GoalProtocolDenyCode;
			reason: string;
	  };

export function protocolStateForGoal(
	goal: GoalState | null,
): Exclude<GoalProtocolState, "completion-candidate" | "unknown"> {
	if (!goal) return "observed-no-goal";
	if (goal.status === "active") return "observed-active";
	if (goal.status === "paused") return "observed-paused";
	return "observed-complete";
}

export const GOAL_PROTOCOL_CAPABILITY_TTL_MS = 5 * 60_000;
export const GOAL_PROTOCOL_TOKEN_TTL_MS = GOAL_PROTOCOL_CAPABILITY_TTL_MS;

export class GoalProtocolCapabilityRegistry {
	private readonly observations = new Map<
		string,
		GoalObservationCapabilityRecord
	>();
	private readonly completions = new Map<
		string,
		GoalCompletionCandidateRecord
	>();
	private readonly epochs = new Map<string, string>();

	currentEpoch(context: GoalProtocolContext): string {
		const contextKey = goalProtocolContextKey(context);
		let epoch = this.epochs.get(contextKey);
		if (!epoch) {
			epoch = randomUUID();
			this.epochs.set(contextKey, epoch);
		}
		return epoch;
	}

	resetEpoch(context: GoalProtocolContext): string {
		const contextKey = goalProtocolContextKey(context);
		this.observations.delete(contextKey);
		this.completions.delete(contextKey);
		const epoch = randomUUID();
		this.epochs.set(contextKey, epoch);
		return epoch;
	}

	issueObservation(
		context: GoalProtocolContext,
		goal: GoalState,
		scopes: GoalProtocolScope[] = ["progress", "prepare-completion"],
		now = Date.now(),
	): GoalObservationCapabilityRecord {
		const contextKey = goalProtocolContextKey(context);
		const record: GoalObservationCapabilityRecord = {
			type: "observation",
			contextKey,
			goalId: goal.goalId,
			revision: goal.revision,
			status: goal.status,
			epoch: this.currentEpoch(context),
			scopes: [...scopes],
			expiresAt: now + GOAL_PROTOCOL_CAPABILITY_TTL_MS,
		};
		this.observations.set(contextKey, record);
		return record;
	}

	issueCompletionCandidate(
		context: GoalProtocolContext,
		goal: GoalState,
		evidence: string,
		now = Date.now(),
	): GoalCompletionCandidateRecord {
		const contextKey = goalProtocolContextKey(context);
		const record: GoalCompletionCandidateRecord = {
			type: "completion-candidate",
			contextKey,
			goalId: goal.goalId,
			revision: goal.revision,
			evidenceHash: hashEvidence(evidence),
			epoch: this.currentEpoch(context),
			expiresAt: now + GOAL_PROTOCOL_CAPABILITY_TTL_MS,
		};
		this.completions.set(contextKey, record);
		return record;
	}

	getObservation(
		context: GoalProtocolContext,
	): GoalObservationCapabilityRecord | null {
		return this.observations.get(goalProtocolContextKey(context)) ?? null;
	}

	getCompletionCandidate(
		context: GoalProtocolContext,
	): GoalCompletionCandidateRecord | null {
		return this.completions.get(goalProtocolContextKey(context)) ?? null;
	}

	invalidateGoal(goalId: string): void {
		for (const [contextKey, record] of this.observations) {
			if (record.goalId === goalId) this.observations.delete(contextKey);
		}
		for (const [contextKey, record] of this.completions) {
			if (record.goalId === goalId) this.completions.delete(contextKey);
		}
	}

	pruneExpired(now = Date.now()): void {
		for (const [contextKey, record] of this.observations) {
			if (record.expiresAt <= now) this.observations.delete(contextKey);
		}
		for (const [contextKey, record] of this.completions) {
			if (record.expiresAt <= now) this.completions.delete(contextKey);
		}
	}
}

export type GoalProtocolTokenRegistry = GoalProtocolCapabilityRegistry;

export const defaultGoalProtocolCapabilities =
	new GoalProtocolCapabilityRegistry();
export const defaultGoalProtocolTokens = defaultGoalProtocolCapabilities;

export function resetGoalProtocolEpoch(context: GoalProtocolContext): void {
	defaultGoalProtocolCapabilities.resetEpoch(context);
}

export function invalidateGoalProtocolCapabilities(goalId: string): void {
	defaultGoalProtocolCapabilities.invalidateGoal(goalId);
}

export const invalidateGoalProtocolTokens = invalidateGoalProtocolCapabilities;

export function hashEvidence(evidence: string): string {
	return createHash("sha256").update(evidence).digest("hex");
}

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
