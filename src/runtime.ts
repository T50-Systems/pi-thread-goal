import { requireGoalProtocolContext } from "./goal-protocol.js";
import { createContinuationGuard } from "./continuation.js";
import {
	handleAgentEndWithLock,
	handleBeforeAgentStart,
	handleContext,
	handleSessionBeforeCompact,
	handleSessionCompact,
	handleSessionStart,
	handleSessionTree,
} from "./runtime-mode-handlers.js";
import type { GoalRuntimeServices } from "./runtime-actions.js";
export {
	filterGoalContextMessages,
	shouldResumeGoalAfterCompaction,
} from "./runtime-guards.js";
import type {
	GoalRuntimeContext,
	RuntimeExtensionAPI,
} from "./runtime-types.js";

export function registerGoalRuntime(pi: unknown): void {
	const lock = { evaluatingGoalId: null as string | null };
	const continuationGuard = createContinuationGuard();
	const runtimePi = pi as RuntimeExtensionAPI;
	const servicesFor = (ctx: unknown): GoalRuntimeServices => {
		const runtimeCtx = ctx as GoalRuntimeContext;
		return {
			runtimePi,
			runtimeCtx,
			protocolContext: requireGoalProtocolContext(runtimeCtx),
			continuationGuard,
		};
	};

	runtimePi.on("before_agent_start", async (_event, ctx) =>
		handleBeforeAgentStart(servicesFor(ctx)),
	);

	runtimePi.on("context", async (event, ctx) =>
		handleContext(event, servicesFor(ctx)),
	);

	runtimePi.on("session_before_compact", async (event, ctx) =>
		handleSessionBeforeCompact(event, ctx as GoalRuntimeContext),
	);

	runtimePi.on("session_compact", async (event, ctx) =>
		handleSessionCompact(servicesFor(ctx), event),
	);

	runtimePi.on("session_start", async (event, ctx) =>
		handleSessionStart(servicesFor(ctx), event),
	);

	runtimePi.on("session_tree", async (_event, ctx) =>
		handleSessionTree(servicesFor(ctx)),
	);

	runtimePi.on("agent_end", async (event, ctx) =>
		handleAgentEndWithLock(servicesFor(ctx), event, lock),
	);
}
