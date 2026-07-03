import { saveGoalState } from "./state.js";
import { validateGoalStateInvariant } from "./state-invariants.js";
import type { GoalRuntimeContext, RuntimeExtensionAPI } from "./runtime-types.js";
import type { GoalStateStore, GoalMessageQueue, GoalNotifier } from "./goal-runtime-ports.js";

export function createPiContinuationStore(
	pi: Pick<RuntimeExtensionAPI, "appendEntry">,
	ctx: Pick<GoalRuntimeContext, "ui">,
): GoalStateStore {
	return {
		markPending(goal, reason) {
			const pending = saveGoalState(
				pi,
				{
					action: "continuation",
					goalId: goal.goalId,
					now: Date.now(),
					pending: true,
					reason,
					source: "runtime",
					explicitUserIntent: false,
					causedBy: "queue-goal-continuation",
				},
				goal,
			);
			if (!pending) return false;
			const invariant = validateGoalStateInvariant(pending);
			if (!invariant.ok) {
				ctx.ui?.notify?.(invariant.reason, "warning");
				return false;
			}
			return true;
		},
	};
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
