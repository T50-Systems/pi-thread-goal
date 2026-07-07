import type { GoalState, GoalStatus } from "./types.js";

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
