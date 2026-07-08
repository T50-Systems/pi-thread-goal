import {
	clearQueuedGoalContinuation,
	type createContinuationGuard,
	MAX_CONTINUATION_DELIVERY_ATTEMPTS,
	queueGoalContinuation,
	shouldPauseForContinuationDeliveryFailure,
	shouldRetryPendingContinuation,
} from "./continuation.js";
import { classifyGoalRuntimeError } from "./evaluator.js";
import { saveGoalOperation } from "./goal-operations.js";
import type { GoalProtocolContext } from "./goal-protocol.js";
import { isGoalActive, validateGoalStateInvariant } from "./goal-state.js";
import { loadGoalState } from "./goal-state-persistence.js";
import { createPiContinuationPorts } from "./pi-continuation-ports.js";
import {
	type GoalNextAction,
	MAX_AUTOMATIC_CONTINUATION_TURNS,
} from "./policies.js";
import { renderGoalContinuationPrompt } from "./prompts.js";
import type {
	GoalRuntimeContext,
	RuntimeExtensionAPI,
} from "./runtime-types.js";
import type { GoalState } from "./types.js";
import { applyGoalUi } from "./ui.js";

export interface GoalRuntimeServices {
	runtimePi: RuntimeExtensionAPI;
	runtimeCtx: GoalRuntimeContext;
	protocolContext: GoalProtocolContext;
	continuationGuard: ReturnType<typeof createContinuationGuard>;
}

type GoalRuntimeMutationServices = Pick<
	GoalRuntimeServices,
	"runtimePi" | "runtimeCtx" | "continuationGuard"
>;

export function applyGoalAction(
	services: GoalRuntimeServices,
	goal: GoalState,
	action: GoalNextAction,
): void {
	const { runtimePi, runtimeCtx, continuationGuard } = services;
	switch (action.type) {
		case "complete": {
			const next = saveGoalOperation(
				runtimePi,
				{
					action: "complete",
					goalId: goal.goalId,
					now: Date.now(),
					evidence: action.reason,
					source: "runtime",
					explicitUserIntent: false,
					causedBy: "goal-next-action:complete",
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
				reason: action.reason,
			});
			return;
		default:
			return;
	}
}

export function pauseGoal(
	services: GoalRuntimeMutationServices,
	goal: GoalState,
	options: {
		reason: "error" | "token-budget" | "turn-limit";
		message: string;
		notification: string;
	},
): void {
	const { runtimePi, runtimeCtx, continuationGuard } = services;
	clearQueuedGoalContinuation(continuationGuard, goal.goalId);
	const paused = saveGoalOperation(
		runtimePi,
		{
			action: "pause",
			goalId: goal.goalId,
			now: Date.now(),
			reason: options.reason,
			message: options.message,
			source: "runtime",
			explicitUserIntent: false,
			causedBy: `goal-next-action:${options.reason}`,
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
	if (!isGoalActive(latest)) return;

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
			reason: `Goal evaluator was interrupted (${message}).`,
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
): boolean {
	if (goal && shouldPauseForContinuationDeliveryFailure(goal, runtimeCtx)) {
		pauseGoal({ runtimePi, runtimeCtx, continuationGuard }, goal, {
			reason: "error",
			message: `Automatic continuation delivery did not start a new agent turn after ${MAX_CONTINUATION_DELIVERY_ATTEMPTS} attempts. Use /goal doctor, then /goal resume or /goal start to continue.`,
			notification: `Goal paused: automatic continuation delivery did not start a new agent turn after ${MAX_CONTINUATION_DELIVERY_ATTEMPTS} attempts. Use /goal doctor, then /goal resume or /goal start to continue.`,
		});
		return true;
	}
	if (!shouldRetryPendingContinuation(goal, runtimeCtx)) return false;
	clearQueuedGoalContinuation(continuationGuard, goal.goalId);
	return queueGoalContinuation({
		ports: createPiContinuationPorts(runtimePi, runtimeCtx),
		ctx: runtimeCtx,
		guard: continuationGuard,
		goal,
		prompt: renderGoalContinuationPrompt(
			goal,
			"A previously queued goal continuation did not start a new agent turn. Retry from the persisted goal state.",
		),
		reason: formatContinuationRetryReason(goal, runtimeCtx),
		phase: "stale-retry",
	});
}

function formatContinuationRetryReason(
	goal: GoalState,
	runtimeCtx: GoalRuntimeContext,
): string {
	const nextAttempt = (goal.continuationAttempt ?? 0) + 1;
	const idle = runtimeCtx.isIdle?.();
	const hasPendingMessages = runtimeCtx.hasPendingMessages?.();
	return [
		"Retrying stale goal continuation because prior delivery did not start a new agent turn.",
		`attempt=${nextAttempt}/${MAX_CONTINUATION_DELIVERY_ATTEMPTS}`,
		`previousMode=${goal.continuationLastMode ?? "unknown"}`,
		`idle=${idle === undefined ? "unknown" : String(idle)}`,
		`hasPendingMessages=${
			hasPendingMessages === undefined ? "unknown" : String(hasPendingMessages)
		}`,
		goal.continuationLastSentAt
			? `lastSentAt=${goal.continuationLastSentAt}`
			: undefined,
		goal.continuationLastStartedAt
			? `lastStartedAt=${goal.continuationLastStartedAt}`
			: undefined,
	]
		.filter((part): part is string => Boolean(part))
		.join(" ");
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
