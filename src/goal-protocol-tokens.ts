import { createHash, randomUUID } from "node:crypto";

import {
	goalProtocolContextKey,
	type GoalProtocolContext,
} from "./goal-protocol-context.js";
import type { GoalState } from "./types.js";
import type {
	GoalCompletionCandidateRecord,
	GoalObservationCapabilityRecord,
	GoalProtocolScope,
} from "./goal-protocol-types.js";

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
