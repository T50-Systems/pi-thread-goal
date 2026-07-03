import { GOAL_CUSTOM_TYPE } from "./goal-state-store.js";
import { cloneGoalState } from "./goal-state-snapshot.js";
import { reduceGoalStateMachine } from "./goal-state-machine.js";
import {
	buildGoalOperationContract,
	verifyGoalOperationContract,
	type GoalOperationContract,
	type GoalOperationContractViolation,
} from "./goal-operation-contracts.js";
import type { GoalEvent, GoalState, GoalStateEntry } from "./types.js";

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
