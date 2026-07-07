import { reduceGoalState } from "./goal-state.js";
import type {
	GoalEvent,
	GoalProgress,
	GoalState,
	GoalStateEntry,
	GoalStateSnapshot,
} from "./types.js";

export const GOAL_CUSTOM_TYPE = "thread-goal-state";

export interface GoalSessionEntry {
	type: string;
	customType?: string;
	data?: unknown;
}

type ParsedGoalReplayEntry =
	| { kind: "event"; event: GoalEvent }
	| { kind: "checkpoint"; state: GoalState };

export function toGoalStateEntry(
	event: GoalEvent,
	current: GoalState | null,
): GoalStateEntry {
	return {
		action: event.action,
		state: cloneGoalState(reduceGoalState(current, event)),
		event: cloneEvent(event),
	};
}

export function createGoalStateSnapshot(
	branchEntries: GoalSessionEntry[],
): GoalStateSnapshot {
	let current: GoalState | null = null;
	const entries: GoalStateEntry[] = [];

	for (const branchEntry of branchEntries) {
		if (
			branchEntry.type !== "custom" ||
			branchEntry.customType !== GOAL_CUSTOM_TYPE
		)
			continue;
		const parsed = parseGoalReplayEntry(branchEntry.data);
		if (!parsed) continue;
		if (parsed.kind === "checkpoint") {
			current = cloneGoalState(parsed.state);
			continue;
		}
		current = reduceGoalState(current, parsed.event);
		entries.push({
			action: parsed.event.action,
			state: cloneGoalState(current),
			event: cloneEvent(parsed.event),
		});
	}

	return { current: cloneGoalState(current), entries };
}

function parseGoalReplayEntry(data: unknown): ParsedGoalReplayEntry | null {
	if (!isRecord(data)) return null;
	const event = parseGoalEvent(data.event);
	if (event) return { kind: "event", event };
	const state = parseGoalState(data.state);
	return state ? { kind: "checkpoint", state } : null;
}

export function cloneGoalState(state: GoalState | null): GoalState | null {
	return state === null
		? null
		: {
				...state,
				acceptanceCriteria: [...state.acceptanceCriteria],
				sourcePaths: [...state.sourcePaths],
				tokenBudget: state.tokenBudget,
				pauseReason: state.pauseReason,
				pauseMessage: state.pauseMessage,
				usage: { ...state.usage },
				progress: {
					done: [...state.progress.done],
					blocked: [...state.progress.blocked],
					current: state.progress.current,
					summary: state.progress.summary,
				},
				dismissedAt: state.dismissedAt,
			};
}

function cloneEvent(event: GoalEvent): GoalEvent {
	return structuredClone(event);
}

function parseGoalEvent(value: unknown): GoalEvent | null {
	if (!isRecord(value)) return null;
	const action = value.action;
	const goalId = value.goalId;
	const now = value.now;
	if (typeof action !== "string" || typeof goalId !== "string") return null;
	if (action !== "create" && typeof now !== "number") return null;
	if (action === "create") {
		return typeof value.objective === "string" && typeof now === "number"
			? {
					action,
					goalId,
					objective: value.objective,
					now,
					acceptanceCriteria: optionalStringArray(value.acceptanceCriteria),
					sourcePaths: optionalStringArray(value.sourcePaths),
					tokenBudget: optionalNumber(value.tokenBudget),
					source: optionalEventSource(value.source),
					explicitUserIntent: optionalBoolean(value.explicitUserIntent),
					causedBy: optionalString(value.causedBy),
				}
			: null;
	}
	if (action === "replace") {
		return typeof value.objective === "string"
			? {
					action,
					goalId,
					objective: value.objective,
					now: now as number,
					acceptanceCriteria: optionalStringArray(value.acceptanceCriteria),
					sourcePaths: optionalStringArray(value.sourcePaths),
					tokenBudget: optionalNumber(value.tokenBudget),
					source: optionalEventSource(value.source),
					explicitUserIntent: optionalBoolean(value.explicitUserIntent),
					causedBy: optionalString(value.causedBy),
				}
			: null;
	}
	if (action === "edit") {
		return optionalString(value.objective) === value.objective ||
			value.objective === undefined
			? {
					action,
					goalId,
					now: now as number,
					objective: optionalString(value.objective),
					acceptanceCriteria: optionalStringArray(value.acceptanceCriteria),
					sourcePaths: optionalStringArray(value.sourcePaths),
					tokenBudget: optionalNumber(value.tokenBudget),
					source: optionalEventSource(value.source),
					explicitUserIntent: optionalBoolean(value.explicitUserIntent),
					causedBy: optionalString(value.causedBy),
				}
			: null;
	}
	if (action === "pause") {
		return {
			action,
			goalId,
			now: now as number,
			reason: optionalString(value.reason) as never,
			message: optionalString(value.message),
			source: optionalEventSource(value.source),
			explicitUserIntent: optionalBoolean(value.explicitUserIntent),
			causedBy: optionalString(value.causedBy),
		};
	}
	if (action === "resume" || action === "clear" || action === "dismiss") {
		return {
			action,
			goalId,
			now: now as number,
			source: optionalEventSource(value.source),
			explicitUserIntent: optionalBoolean(value.explicitUserIntent),
			causedBy: optionalString(value.causedBy),
		} as GoalEvent;
	}
	if (action === "complete") {
		if (value.evidence !== undefined && typeof value.evidence !== "string") {
			return null;
		}
		return {
			action,
			goalId,
			now: now as number,
			evidence: optionalString(value.evidence),
			source: optionalEventSource(value.source),
			explicitUserIntent: optionalBoolean(value.explicitUserIntent),
			causedBy: optionalString(value.causedBy),
		};
	}
	if (action === "progress") {
		return isRecord(value.progress)
			? {
					action,
					goalId,
					now: now as number,
					progress: parseProgress(value.progress),
					source: optionalEventSource(value.source),
					explicitUserIntent: optionalBoolean(value.explicitUserIntent),
					causedBy: optionalString(value.causedBy),
				}
			: null;
	}
	if (action === "evaluation") {
		return typeof value.reason === "string"
			? {
					action,
					goalId,
					now: now as number,
					reason: value.reason,
					usage: isRecord(value.usage) ? (value.usage as never) : undefined,
					source: optionalEventSource(value.source),
					explicitUserIntent: optionalBoolean(value.explicitUserIntent),
					causedBy: optionalString(value.causedBy),
				}
			: null;
	}
	if (action === "continuation") {
		return typeof value.pending === "boolean"
			? {
					action,
					goalId,
					now: now as number,
					pending: value.pending,
					reason: optionalString(value.reason),
					phase: optionalString(value.phase) as never,
					error: optionalString(value.error),
					mode: optionalString(value.mode) as never,
					source: optionalEventSource(value.source),
					explicitUserIntent: optionalBoolean(value.explicitUserIntent),
					causedBy: optionalString(value.causedBy),
				}
			: null;
	}
	return null;
}

function parseGoalState(value: unknown): GoalState | null {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		typeof value.goalId !== "string" ||
		typeof value.objective !== "string" ||
		!isGoalStatus(value.status)
	) {
		return null;
	}
	const progress = isRecord(value.progress) ? value.progress : {};
	const usage = isRecord(value.usage) ? value.usage : {};
	return {
		...(value as object),
		version: 1,
		revision: typeof value.revision === "number" ? value.revision : 1,
		goalId: value.goalId,
		objective: value.objective,
		status: value.status,
		acceptanceCriteria: stringArray(value.acceptanceCriteria),
		sourcePaths: stringArray(value.sourcePaths),
		tokenBudget: optionalNumber(value.tokenBudget),
		progress: {
			done: stringArray(progress.done),
			blocked: stringArray(progress.blocked),
			current: optionalString(progress.current),
			summary: optionalString(progress.summary) ?? "",
		},
		createdAt: numberOr(value.createdAt, 0),
		updatedAt: numberOr(value.updatedAt, 0),
		runStartedAt: numberOr(value.runStartedAt, 0),
		evaluationTurns: numberOr(value.evaluationTurns, 0),
		usage: {
			input: numberOr(usage.input, 0),
			output: numberOr(usage.output, 0),
			cacheRead: numberOr(usage.cacheRead, 0),
			cacheWrite: numberOr(usage.cacheWrite, 0),
			total: numberOr(usage.total, 0),
		},
		lastEvaluationReason:
			optionalString(value.lastEvaluationReason) ?? "Goal restored.",
	} as GoalState;
}

function parseProgress(value: Record<string, unknown>): Partial<GoalProgress> {
	return {
		done: optionalStringArray(value.done),
		current: optionalString(value.current),
		blocked: optionalStringArray(value.blocked),
		summary: optionalString(value.summary),
	};
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? [...value]
		: undefined;
}

function stringArray(value: unknown): string[] {
	return optionalStringArray(value) ?? [];
}

function numberOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalEventSource(value: unknown) {
	return value === "user-command" ||
		value === "model-tool" ||
		value === "runtime"
		? value
		: undefined;
}

function isGoalStatus(value: unknown): value is GoalState["status"] {
	return value === "active" || value === "paused" || value === "complete";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}


export interface GoalSessionContext {
	sessionManager: {
		getBranch(): GoalSessionEntry[];
	};
}

export interface GoalAppendAPI {
	appendEntry(customType: string, data?: unknown): unknown;
}

/**
 * Low-level legacy reducer persistence used for replay-compatible callers.
 * Prefer saveGoalOperation/executeGoalOperation for runtime, tool, and user
 * mutations so goal operation contracts verify metadata and postconditions.
 */
export function saveGoalState(
	pi: GoalAppendAPI,
	event: GoalEvent,
	current: GoalState | null,
): GoalState | null {
	const entry = toGoalStateEntry(event, current);
	pi.appendEntry(GOAL_CUSTOM_TYPE, entry);
	return entry.state;
}

export function loadGoalState(ctx: GoalSessionContext): GoalState | null {
	return createGoalStateSnapshot(ctx.sessionManager.getBranch()).current;
}
