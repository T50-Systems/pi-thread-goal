import {
	clearQueuedGoalContinuation,
	type createContinuationGuard,
	queueGoalContinuation,
	shouldRetryPendingContinuation,
} from "./continuation.js";
import { classifyGoalRuntimeError } from "./evaluator-policy.js";
import { MAX_AUTOMATIC_CONTINUATION_TURNS, type GoalNextAction } from "./next-action.js";
import { createPiContinuationPorts } from "./pi-continuation-ports.js";
import { renderGoalContinuationPrompt } from "./prompts.js";
import { loadGoalState, saveGoalState } from "./state.js";
import { validateGoalStateInvariant } from "./state-invariants.js";
import { applyGoalUi } from "./ui.js";
import type { GoalState } from "./types.js";
import type { GoalRuntimeContext, RuntimeExtensionAPI } from "./runtime-types.js";

export interface GoalRuntimeServices {
	runtimePi: RuntimeExtensionAPI;
	runtimeCtx: GoalRuntimeContext;
	continuationGuard: ReturnType<typeof createContinuationGuard>;
}

export function applyGoalAction(
	services: GoalRuntimeServices,
	goal: GoalState,
	action: GoalNextAction,
): void {
	const { runtimePi, runtimeCtx, continuationGuard } = services;
	switch (action.type) {
		case "complete": {
			const next = saveGoalState(
				runtimePi,
				{
					action: "complete",
					goalId: goal.goalId,
					now: Date.now(),
					evidence: action.reason,
				},
				goal,
			);
			if (!next) {
				runtimeCtx.ui?.notify?.(
					"Goal completion did not persist state; skipping completion notification.",
					"warning",
				);
				return;
			}
			if (!ensureGoalStateInvariant(runtimeCtx, next)) return;
			applyGoalUi(runtimeCtx, next);
			runtimeCtx.ui?.notify?.(`Goal complete: ${action.reason}`, "info");
			return;
		}
		case "pause-error":
			pauseGoal({ runtimePi, runtimeCtx, continuationGuard }, goal, {
				reason: "error",
				message: action.reason,
				notification: `Goal paused: ${action.reason}`,
			});
			return;
		case "pause-token-budget":
			pauseGoal({ runtimePi, runtimeCtx, continuationGuard }, goal, {
				reason: "token-budget",
				message: action.reason,
				notification:
					"Goal paused because the token budget was reached. Use /goal resume to continue.",
			});
			return;
		case "pause-turn-limit":
			pauseGoal({ runtimePi, runtimeCtx, continuationGuard }, goal, {
				reason: "turn-limit",
				message: action.reason,
				notification: `Goal paused after ${MAX_AUTOMATIC_CONTINUATION_TURNS} evaluator turns without completion. Review progress, then use /goal resume to continue.`,
			});
			return;
		case "continue":
			applyGoalUi(runtimeCtx, goal);
			queueGoalContinuation({
				ports: createPiContinuationPorts(runtimePi, runtimeCtx),
				ctx: runtimeCtx,
				guard: continuationGuard,
				goal,
				prompt: renderGoalContinuationPrompt(goal, action.reason),
			});
			return;
		default:
			return;
	}
}

export function pauseGoal(
	services: GoalRuntimeServices,
	goal: GoalState,
	options: {
		reason: "error" | "token-budget" | "turn-limit";
		message: string;
		notification: string;
	},
): void {
	const { runtimePi, runtimeCtx, continuationGuard } = services;
	clearQueuedGoalContinuation(continuationGuard, goal.goalId);
	const paused = saveGoalState(
		runtimePi,
		{
			action: "pause",
			goalId: goal.goalId,
			now: Date.now(),
			reason: options.reason,
			message: options.message,
		},
		goal,
	);
	if (!paused) {
		runtimeCtx.ui?.notify?.(
			"Goal pause did not persist state; skipping pause notification.",
			"warning",
		);
		return;
	}
	if (!ensureGoalStateInvariant(runtimeCtx, paused)) return;
	applyGoalUi(runtimeCtx, paused);
	runtimeCtx.ui?.notify?.(options.notification, "warning");
}

export function handleEvaluatorError(
	runtimePi: RuntimeExtensionAPI,
	runtimeCtx: GoalRuntimeContext,
	continuationGuard: ReturnType<typeof createContinuationGuard>,
	error: unknown,
): void {
	const kind = classifyGoalRuntimeError(error);
	const latest = loadGoalState(runtimeCtx);
	if (!isActiveGoal(latest)) return;

	const message = error instanceof Error ? error.message : String(error);
	if (kind === "retryable") {
		applyGoalUi(runtimeCtx, latest);
		queueGoalContinuation({
			ports: createPiContinuationPorts(runtimePi, runtimeCtx),
			ctx: runtimeCtx,
			guard: continuationGuard,
			goal: latest,
			prompt: renderGoalContinuationPrompt(
				latest,
				`Goal evaluator was interrupted (${message}). Continue from persisted goal state instead of waiting for another user turn.`,
			),
		});
		return;
	}

	pauseGoal({ runtimePi, runtimeCtx, continuationGuard }, latest, {
		reason: "error",
		message,
		notification: `Goal paused after evaluator error: ${message}`,
	});
}

export function retryPendingContinuation(
	runtimePi: RuntimeExtensionAPI,
	runtimeCtx: GoalRuntimeContext,
	continuationGuard: ReturnType<typeof createContinuationGuard>,
	goal: GoalState | null,
): void {
	if (!shouldRetryPendingContinuation(goal, runtimeCtx)) return;
	clearQueuedGoalContinuation(continuationGuard, goal.goalId);
	queueGoalContinuation({
		ports: createPiContinuationPorts(runtimePi, runtimeCtx),
		ctx: runtimeCtx,
		guard: continuationGuard,
		goal,
		prompt: renderGoalContinuationPrompt(
			goal,
			"A previously queued goal continuation did not start. Retry from the persisted goal state.",
		),
	});
}

export function ensureGoalStateInvariant(
	runtimeCtx: GoalRuntimeContext,
	goal: GoalState,
): boolean {
	const invariant = validateGoalStateInvariant(goal);
	if (!invariant.ok) {
		runtimeCtx.ui?.notify?.(invariant.reason, "warning");
		return false;
	}
	return true;
}

function isActiveGoal(goal: GoalState | null): goal is GoalState {
	return goal !== null && goal.status === "active";
}
