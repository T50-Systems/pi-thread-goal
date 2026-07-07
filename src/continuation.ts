import {
	canAutoResumeGoal,
	canQueueGoalContinuation,
} from "./goal-state.js";
import type {
	GoalContinuationMode,
	GoalContinuationPhase,
	GoalState,
} from "./types.js";
import type { RuntimeIdleContext, SessionStartEvent } from "./runtime-types.js";

export interface GoalStateStore {
	markPending(
		goal: GoalState,
		reason: string,
		options?: {
			phase?: Extract<GoalContinuationPhase, "queued" | "stale-retry">;
		},
	): GoalState | null;
	markSent(
		goal: GoalState,
		options: { reason: string; mode: GoalContinuationMode },
	): GoalState | null;
	markFailed(
		goal: GoalState,
		options: { reason: string; mode?: GoalContinuationMode; error: string },
	): GoalState | null;
}

export interface GoalMessageQueue {
	send(prompt: string, mode: "immediate" | "followUp"): void;
}

export interface GoalNotifier {
	notify?(message: string, level?: "info" | "warning" | "error"): void;
}

export interface GoalRuntimeIdleProbe {
	isIdle?: () => boolean;
	hasPendingMessages?: () => boolean;
}



export interface ContinuationGuardState {
	queuedGoalId: string | null;
}

export interface GoalContinuationPorts {
	store: GoalStateStore;
	queue: GoalMessageQueue;
	notifier?: GoalNotifier;
}

export const CONTINUATION_WATCHDOG_MS = 30_000;
export const MAX_CONTINUATION_DELIVERY_ATTEMPTS = 3;

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
		canAutoResumeGoal(goal) &&
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
		canQueueGoalContinuation(goal) &&
		hasStalePendingContinuation(goal, now) &&
		!hasReachedContinuationDeliveryLimit(goal) &&
		ctx.isIdle?.() === true &&
		ctx.hasPendingMessages?.() !== true
	);
}

export function shouldPauseForContinuationDeliveryFailure(
	goal: GoalState | null,
	ctx: RuntimeIdleContext,
	now = Date.now(),
): boolean {
	return (
		canQueueGoalContinuation(goal) &&
		hasStalePendingContinuation(goal, now) &&
		hasReachedContinuationDeliveryLimit(goal) &&
		ctx.isIdle?.() === true &&
		ctx.hasPendingMessages?.() !== true
	);
}

export function getContinuationRetryDelayMs(goal: GoalState): number {
	const attempt = Math.max(1, goal.continuationAttempt ?? 1);
	return CONTINUATION_WATCHDOG_MS * 2 ** Math.min(attempt - 1, 2);
}

export function hasReachedContinuationDeliveryLimit(goal: GoalState): boolean {
	return (goal.continuationAttempt ?? 0) >= MAX_CONTINUATION_DELIVERY_ATTEMPTS;
}

export function hasStalePendingContinuation(
	goal: GoalState,
	now = Date.now(),
): boolean {
	return (
		typeof goal.continuationPendingAt === "number" &&
		now - goal.continuationPendingAt >= getContinuationRetryDelayMs(goal)
	);
}

export function shouldQueueGoalContinuation(
	guard: ContinuationGuardState,
	goal: GoalState,
): boolean {
	if (!canQueueGoalContinuation(goal)) return false;
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
	reason?: string;
	phase?: Extract<GoalContinuationPhase, "queued" | "stale-retry">;
	notification?: string;
}

export function queueGoalContinuation(
	input: QueueGoalContinuationInput,
): boolean {
	const { ports, ctx, guard, goal, prompt, notification } = input;
	const reason = input.reason ?? "Queued goal continuation.";
	const phase = input.phase ?? "queued";
	if (!shouldQueueGoalContinuation(guard, goal)) return false;
	let pendingGoal: GoalState | null;
	try {
		pendingGoal = ports.store.markPending(goal, reason, { phase });
	} catch (error) {
		clearQueuedGoalContinuation(guard, goal.goalId);
		ports.notifier?.notify?.(
			`Goal continuation could not be queued because pending state was not persisted: ${error instanceof Error ? error.message : String(error)}.`,
			"warning",
		);
		return false;
	}
	if (!pendingGoal) {
		clearQueuedGoalContinuation(guard, goal.goalId);
		ports.notifier?.notify?.(
			"Goal continuation could not be queued because pending state was not persisted.",
			"warning",
		);
		return false;
	}
	const mode =
		ctx.isIdle?.() === true && ctx.hasPendingMessages?.() !== true
			? "immediate"
			: "followUp";
	try {
		ports.queue.send(prompt, mode);
	} catch (error) {
		const message = formatContinuationError(error);
		clearQueuedGoalContinuation(guard, goal.goalId);
		try {
			ports.store.markFailed(pendingGoal, { reason, mode, error: message });
		} catch (markError) {
			ports.notifier?.notify?.(
				`Goal continuation send failed, and failed state could not be persisted: ${formatContinuationError(markError)}.`,
				"warning",
			);
		}
		ports.notifier?.notify?.(
			`Goal continuation could not be queued: ${message}. It will be retried if the pending marker remains stale.`,
			"warning",
		);
		return false;
	}
	try {
		const sent = ports.store.markSent(pendingGoal, { reason, mode });
		if (!sent) {
			ports.notifier?.notify?.(
				"Goal continuation was sent, but sent state was not persisted; stale-pending watchdog may retry it.",
				"warning",
			);
		}
	} catch (error) {
		ports.notifier?.notify?.(
			`Goal continuation was sent, but sent state could not be persisted: ${formatContinuationError(error)}. Stale-pending watchdog may retry it.`,
			"warning",
		);
	}
	if (notification) ports.notifier?.notify?.(notification, "info");
	return true;
}

function formatContinuationError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
