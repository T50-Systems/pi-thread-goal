import type { GoalEvent, GoalEventSource, GoalState, GoalStateEntry, GoalStatus } from "./types.js";


export type GoalOperationName = GoalEvent["action"];
export type GoalStatusRequirement = GoalStatus | "none" | "any";

export interface GoalOperationContract {
	operation: GoalOperationName;
	beforeStatus: GoalStatusRequirement;
	afterStatus: GoalStatusRequirement;
	requiredSource: GoalEventSource;
	requiredExplicitUserIntent: boolean;
	requireCausedBy: boolean;
	mustClearPause?: boolean;
	mustResetRun?: boolean;
	mustClearContinuation?: boolean;
	mustClearBlocked?: boolean;
	forbidModelTool?: boolean;
	forbidRuntime?: boolean;
}

export interface GoalOperationContractViolation {
	field: string;
	reason: string;
}

export interface GoalOperationContractResult {
	ok: boolean;
	violations: GoalOperationContractViolation[];
}

export function buildGoalOperationContract(
	event: GoalEvent,
): GoalOperationContract {
	const source = requiredSource(event);
	const explicitUserIntent = requiredExplicitUserIntent(event);
	const base = {
		operation: event.action,
		requiredSource: source,
		requiredExplicitUserIntent: explicitUserIntent,
		requireCausedBy: true,
	} satisfies Pick<
		GoalOperationContract,
		| "operation"
		| "requiredSource"
		| "requiredExplicitUserIntent"
		| "requireCausedBy"
	>;

	switch (event.action) {
		case "create":
			return { ...base, beforeStatus: "none", afterStatus: "active" };
		case "replace":
			return { ...base, beforeStatus: "any", afterStatus: "active" };
		case "edit":
			return { ...base, beforeStatus: "any", afterStatus: "any" };
		case "pause":
			return {
				...base,
				beforeStatus: "active",
				afterStatus: "paused",
				mustClearContinuation: true,
			};
		case "resume":
			return {
				...base,
				beforeStatus: "paused",
				afterStatus: "active",
				requiredSource: "user-command",
				requiredExplicitUserIntent: true,
				mustClearPause: true,
				mustResetRun: true,
			};
		case "clear":
			return { ...base, beforeStatus: "any", afterStatus: "none" };
		case "complete":
			return {
				...base,
				beforeStatus: "active",
				afterStatus: "complete",
				mustClearContinuation: true,
				mustClearBlocked: true,
			};
		case "dismiss":
			return { ...base, beforeStatus: "any", afterStatus: "any" };
		case "progress":
			return { ...base, beforeStatus: "active", afterStatus: "active" };
		case "evaluation":
			return { ...base, beforeStatus: "active", afterStatus: "active" };
		case "continuation":
			return { ...base, beforeStatus: "active", afterStatus: "active" };
	}
}

export function buildResumeGoalContract(
	event: Extract<GoalEvent, { action: "resume" }>,
): GoalOperationContract {
	return buildGoalOperationContract(event);
}

export function buildPauseGoalContract(
	event: Extract<GoalEvent, { action: "pause" }>,
): GoalOperationContract {
	return buildGoalOperationContract(event);
}

export function buildCompleteGoalContract(
	event: Extract<GoalEvent, { action: "complete" }>,
): GoalOperationContract {
	return buildGoalOperationContract(event);
}

export function buildProgressGoalContract(
	event: Extract<GoalEvent, { action: "progress" }>,
): GoalOperationContract {
	return buildGoalOperationContract(event);
}

export function buildContinuationGoalContract(
	event: Extract<GoalEvent, { action: "continuation" }>,
): GoalOperationContract {
	return buildGoalOperationContract(event);
}

export function buildEvaluationGoalContract(
	event: Extract<GoalEvent, { action: "evaluation" }>,
): GoalOperationContract {
	return buildGoalOperationContract(event);
}

export function verifyGoalOperationContract(input: {
	contract: GoalOperationContract;
	before: GoalState | null;
	event: GoalEvent;
	after: GoalState | null;
}): GoalOperationContractResult {
	const violations: GoalOperationContractViolation[] = [];
	const { contract, before, event, after } = input;

	if (event.action !== contract.operation) {
		violations.push({
			field: "event.action",
			reason: `Expected ${contract.operation}, received ${event.action}.`,
		});
	}
	verifyStatus("before.status", before, contract.beforeStatus, violations);
	verifyStatus("after.status", after, contract.afterStatus, violations);
	verifyRevision(
		"after.revision",
		before,
		after,
		contract.afterStatus,
		violations,
	);
	if (event.source !== contract.requiredSource) {
		violations.push({
			field: "event.source",
			reason: `Expected ${contract.requiredSource}, received ${event.source ?? "missing"}.`,
		});
	}
	if (event.explicitUserIntent !== contract.requiredExplicitUserIntent) {
		violations.push({
			field: "event.explicitUserIntent",
			reason: `Expected ${String(contract.requiredExplicitUserIntent)}, received ${String(event.explicitUserIntent)}.`,
		});
	}
	if (contract.requireCausedBy && !event.causedBy?.trim()) {
		violations.push({
			field: "event.causedBy",
			reason: "Goal operation events must include causedBy for auditability.",
		});
	}
	if (contract.forbidModelTool && event.source === "model-tool") {
		violations.push({
			field: "event.source",
			reason: "Model tools are not allowed for this operation.",
		});
	}
	if (contract.forbidRuntime && event.source === "runtime") {
		violations.push({
			field: "event.source",
			reason: "Runtime is not allowed for this operation.",
		});
	}
	if (contract.mustClearPause && after) {
		if (after.pauseReason !== undefined || after.pauseMessage !== undefined) {
			violations.push({
				field: "after.pause",
				reason: "Resume must clear pause reason and message.",
			});
		}
	}
	if (contract.mustResetRun && after) {
		if (after.evaluationTurns !== 0 || after.usage.total !== 0) {
			violations.push({
				field: "after.run",
				reason: "Resume must reset evaluation turns and usage.",
			});
		}
	}
	if (contract.mustClearContinuation && after) {
		if (
			after.continuationPendingAt !== undefined ||
			after.continuationReason !== undefined
		) {
			violations.push({
				field: "after.continuation",
				reason: "Operation must clear pending continuation state.",
			});
		}
	}
	if (contract.mustClearBlocked && after && after.progress.blocked.length > 0) {
		violations.push({
			field: "after.progress.blocked",
			reason: "Completion must clear blockers.",
		});
	}

	return { ok: violations.length === 0, violations };
}

function requiredSource(event: GoalEvent): GoalEventSource {
	if (event.source) return event.source;
	throw new Error(`Goal ${event.action} event requires source metadata.`);
}

function requiredExplicitUserIntent(event: GoalEvent): boolean {
	if (event.explicitUserIntent !== undefined) return event.explicitUserIntent;
	throw new Error(
		`Goal ${event.action} event requires explicitUserIntent metadata.`,
	);
}

function verifyStatus(
	field: string,
	goal: GoalState | null,
	required: GoalStatusRequirement,
	violations: GoalOperationContractViolation[],
): void {
	if (required === "any") {
		if (!goal) {
			violations.push({ field, reason: "Expected an existing goal." });
		}
		return;
	}
	if (required === "none") {
		if (goal) {
			violations.push({ field, reason: "Expected no goal." });
		}
		return;
	}
	if (!goal || goal.status !== required) {
		violations.push({
			field,
			reason: `Expected ${required}, received ${goal?.status ?? "none"}.`,
		});
	}
}

function verifyRevision(
	field: string,
	before: GoalState | null,
	after: GoalState | null,
	afterStatus: GoalStatusRequirement,
	violations: GoalOperationContractViolation[],
): void {
	if (afterStatus === "none") return;
	if (!after) return;
	const expected =
		before && before.goalId === after.goalId ? before.revision + 1 : 1;
	if (after.revision !== expected) {
		violations.push({
			field,
			reason: `Expected ${expected}, received ${after.revision}.`,
		});
	}
}

import { GOAL_CUSTOM_TYPE } from "./goal-state-persistence.js";
import { cloneGoalState } from "./goal-state-persistence.js";
import { reduceGoalStateMachine } from "./goal-state.js";
import { invalidateGoalProtocolCapabilities } from "./goal-protocol.js";

export interface GoalOperationAppendAPI {
	appendEntry(customType: string, data?: unknown): unknown;
}

export type GoalOperationResult =
	| { ok: true; state: GoalState | null; entry: GoalStateEntry }
	| {
			ok: false;
			state: GoalState | null;
			violations: GoalOperationContractViolation[];
	  };

export function executeGoalOperation(input: {
	pi: GoalOperationAppendAPI;
	before: GoalState | null;
	event: GoalEvent;
	contract?: GoalOperationContract;
}): GoalOperationResult {
	const contract = input.contract ?? buildGoalOperationContract(input.event);
	const after = reduceGoalStateMachine(input.before, input.event);
	const result = verifyGoalOperationContract({
		contract,
		before: input.before,
		event: input.event,
		after,
	});
	if (!result.ok) {
		return {
			ok: false,
			state: input.before,
			violations: result.violations,
		};
	}

	const entry = toContractedGoalStateEntry(input.event, after);
	input.pi.appendEntry(GOAL_CUSTOM_TYPE, entry);
	invalidateGoalProtocolCapabilities(input.event.goalId);
	if (input.before?.goalId && input.before.goalId !== input.event.goalId) {
		invalidateGoalProtocolCapabilities(input.before.goalId);
	}
	return { ok: true, state: entry.state, entry };
}

export function saveGoalOperation(
	pi: GoalOperationAppendAPI,
	event: GoalEvent,
	before: GoalState | null,
	contract?: GoalOperationContract,
): GoalState | null {
	const result = executeGoalOperation({ pi, before, event, contract });
	if (result.ok) return result.state;
	throw new Error(formatGoalOperationViolation(event, result.violations));
}

function toContractedGoalStateEntry(
	event: GoalEvent,
	state: GoalState | null,
): GoalStateEntry {
	return {
		action: event.action,
		state: cloneGoalState(state),
		event: structuredClone(event),
	};
}

function formatGoalOperationViolation(
	event: GoalEvent,
	violations: GoalOperationContractViolation[],
): string {
	const details = violations
		.map((violation) => `${violation.field}: ${violation.reason}`)
		.join("; ");
	return `Goal ${event.action} operation violated its contract${details ? ` (${details})` : ""}.`;
}
