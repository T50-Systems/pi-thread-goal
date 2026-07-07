import { saveGoalOperation } from "./goal-operations.js";
import { validateGoalStateInvariant } from "./goal-state.js";
import type {
	GoalRuntimeContext,
	RuntimeExtensionAPI,
} from "./runtime-types.js";
import type {
	GoalStateStore,
	GoalMessageQueue,
	GoalNotifier,
} from "./goal-runtime-ports.js";
import type {
	GoalContinuationMode,
	GoalContinuationPhase,
	GoalState,
} from "./types.js";

export function createPiContinuationStore(
	pi: Pick<RuntimeExtensionAPI, "appendEntry">,
	ctx: Pick<GoalRuntimeContext, "ui">,
): GoalStateStore {
	return {
		markPending(goal, reason, options) {
			return saveContinuation(pi, ctx, goal, {
				pending: true,
				phase: options?.phase ?? "queued",
				reason,
				causedBy: "queue-goal-continuation",
			});
		},
		markSent(goal, options) {
			return saveContinuation(pi, ctx, goal, {
				pending: true,
				phase: "sent",
				reason: options.reason,
				mode: options.mode,
				causedBy: "send-goal-continuation",
			});
		},
		markFailed(goal, options) {
			return saveContinuation(pi, ctx, goal, {
				pending: true,
				phase: "failed",
				reason: options.reason,
				mode: options.mode,
				error: options.error,
				causedBy: "send-goal-continuation:failed",
			});
		},
	};
}

function saveContinuation(
	pi: Pick<RuntimeExtensionAPI, "appendEntry">,
	ctx: Pick<GoalRuntimeContext, "ui">,
	goal: GoalState,
	input: {
		pending: boolean;
		phase: GoalContinuationPhase;
		reason: string;
		mode?: GoalContinuationMode;
		error?: string;
		causedBy: string;
	},
) {
	const next = saveGoalOperation(
		pi,
		{
			action: "continuation",
			goalId: goal.goalId,
			now: Date.now(),
			pending: input.pending,
			phase: input.phase,
			reason: input.reason,
			mode: input.mode,
			error: input.error,
			source: "runtime",
			explicitUserIntent: false,
			causedBy: input.causedBy,
		},
		goal,
	);
	if (!next) return null;
	const invariant = validateGoalStateInvariant(next);
	if (!invariant.ok) {
		ctx.ui?.notify?.(invariant.reason, "warning");
		return null;
	}
	return next;
}

export function createPiMessageQueue(
	pi: Pick<RuntimeExtensionAPI, "sendUserMessage">,
): GoalMessageQueue {
	return {
		send(prompt, mode) {
			if (mode === "immediate") {
				pi.sendUserMessage(prompt);
			} else {
				pi.sendUserMessage(prompt, { deliverAs: "followUp" });
			}
		},
	};
}

export function createPiNotifier(
	ctx: Pick<GoalRuntimeContext, "ui">,
): GoalNotifier {
	return { notify: ctx.ui?.notify };
}

export function createPiContinuationPorts(
	pi: Pick<RuntimeExtensionAPI, "sendUserMessage" | "appendEntry">,
	ctx: GoalRuntimeContext,
) {
	return {
		store: createPiContinuationStore(pi, ctx),
		queue: createPiMessageQueue(pi),
		notifier: createPiNotifier(ctx),
	};
}
