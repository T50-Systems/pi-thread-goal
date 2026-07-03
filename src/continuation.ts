import type { GoalState } from "./types.js";
import type { RuntimeIdleContext, SessionStartEvent } from "./runtime-types.js";
import type {
	GoalMessageQueue,
	GoalNotifier,
	GoalStateStore,
} from "./goal-runtime-ports.js";

export interface ContinuationGuardState {
	queuedGoalId: string | null;
}

export interface GoalContinuationPorts {
	store: GoalStateStore;
	queue: GoalMessageQueue;
	notifier?: GoalNotifier;
}

export const CONTINUATION_WATCHDOG_MS = 30_000;

export function createContinuationGuard(): ContinuationGuardState {
	return { queuedGoalId: null };
}


export function shouldResumeGoalAfterSessionStart(
	goal: GoalState | null,
	event: SessionStartEvent,
	ctx: RuntimeIdleContext,
	guard: ContinuationGuardState = createContinuationGuard(),
): goal is GoalState {
	return (
		event.reason === "resume" &&
		isActiveGoal(goal) &&
		ctx.isIdle?.() === true &&
		ctx.hasPendingMessages?.() !== true &&
		guard.queuedGoalId !== goal.goalId
	);
}

export function shouldRetryPendingContinuation(
	goal: GoalState | null,
	ctx: RuntimeIdleContext,
	now = Date.now(),
): goal is GoalState {
	return (
		isActiveGoal(goal) &&
		typeof goal.continuationPendingAt === "number" &&
		now - goal.continuationPendingAt >= CONTINUATION_WATCHDOG_MS &&
		ctx.isIdle?.() === true &&
		ctx.hasPendingMessages?.() !== true
	);
}

export function shouldQueueGoalContinuation(
	guard: ContinuationGuardState,
	goal: GoalState,
): boolean {
	if (!isActiveGoal(goal)) return false;
	if (guard.queuedGoalId === goal.goalId) return false;
	guard.queuedGoalId = goal.goalId;
	return true;
}

export function clearQueuedGoalContinuation(
	guard: ContinuationGuardState,
	goalId?: string,
): void {
	if (!goalId || guard.queuedGoalId === goalId) {
		guard.queuedGoalId = null;
	}
}

export interface QueueGoalContinuationInput {
	ports: GoalContinuationPorts;
	ctx: RuntimeIdleContext;
	guard: ContinuationGuardState;
	goal: GoalState;
	prompt: string;
	notification?: string;
}

export function queueGoalContinuation(
	input: QueueGoalContinuationInput,
): boolean {
	const { ports, ctx, guard, goal, prompt, notification } = input;
	if (!shouldQueueGoalContinuation(guard, goal)) return false;
	let pendingPersisted: boolean;
	try {
		pendingPersisted = ports.store.markPending(
			goal,
			"Queued goal continuation.",
		);
	} catch (error) {
		clearQueuedGoalContinuation(guard, goal.goalId);
		ports.notifier?.notify?.(
			`Goal continuation could not be queued because pending state was not persisted: ${error instanceof Error ? error.message : String(error)}.`,
			"warning",
		);
		return false;
	}
	if (!pendingPersisted) {
		clearQueuedGoalContinuation(guard, goal.goalId);
		ports.notifier?.notify?.(
			"Goal continuation could not be queued because pending state was not persisted.",
			"warning",
		);
		return false;
	}
	try {
		const mode =
			ctx.isIdle?.() === true && ctx.hasPendingMessages?.() !== true
				? "immediate"
				: "followUp";
		ports.queue.send(prompt, mode);
	} catch (error) {
		clearQueuedGoalContinuation(guard, goal.goalId);
		ports.notifier?.notify?.(
			`Goal continuation could not be queued: ${error instanceof Error ? error.message : String(error)}. It will be retried if the pending marker remains stale.`,
			"warning",
		);
		return false;
	}
	if (notification) ports.notifier?.notify?.(notification, "info");
	return true;
}

function isActiveGoal(goal: GoalState | null): goal is GoalState {
	return goal !== null && goal.status === "active";
}
