import { isGoalActive } from "./goal-state-machine.js";
import {
	clearQueuedGoalContinuation,
	queueGoalContinuation,
	shouldResumeGoalAfterSessionStart,
} from "./continuation.js";
import { evaluateGoal } from "./evaluator.js";
import { decideGoalNextAction } from "./next-action.js";
import { createPiContinuationPorts } from "./pi-continuation-ports.js";
import { observeGoal } from "./goal-protocol-policy.js";
import { resetGoalProtocolEpoch } from "./goal-protocol-tokens.js";
import {
	GOAL_CONTEXT_CUSTOM_TYPE,
	GOAL_PAUSED_CONTEXT_CUSTOM_TYPE,
	renderGoalCompactionSummary,
	renderGoalContext,
	renderGoalContinuationPrompt,
	renderPausedGoalContext,
} from "./prompts.js";
import {
	applyGoalAction,
	ensureGoalStateInvariant,
	handleEvaluatorError,
	pauseGoal,
	retryPendingContinuation,
	type GoalRuntimeServices,
} from "./runtime-actions.js";
import {
	filterGoalContextMessages,
	shouldResumeGoalAfterCompaction,
} from "./runtime-guards.js";
import { loadGoalState } from "./state.js";
import { saveGoalOperation } from "./goal-operation-workflow.js";
import { applyGoalUi } from "./ui.js";
import { collectUsage } from "./usage-collector.js";
import type { GoalProtocolCapabilitySummary } from "./goal-protocol-types.js";
import type {
	AgentEndEvent,
	ContextEvent,
	GoalRuntimeContext,
	SessionBeforeCompactEvent,
	SessionStartEvent,
	CompactionResumeEvent,
} from "./runtime-types.js";

type BeforeAgentStartResult = {
	message: {
		customType: string;
		content: string;
		display: false;
		details: { goalId: string; capability?: GoalProtocolCapabilitySummary };
	};
};

type SessionBeforeCompactResult = {
	compaction: {
		summary: string;
		firstKeptEntryId?: string;
		tokensBefore?: number;
		details: { goalId: string };
	};
};

export async function handleBeforeAgentStart(
	services: GoalRuntimeServices,
): Promise<BeforeAgentStartResult | undefined> {
	const { runtimePi, runtimeCtx, continuationGuard, protocolContext } =
		services;
	resetGoalProtocolEpoch(protocolContext);
	const goal = loadGoalState(runtimeCtx);
	if (!goal) return undefined;
	clearQueuedGoalContinuation(continuationGuard, goal.goalId);
	if (!isGoalActive(goal)) {
		return {
			message: {
				customType: GOAL_PAUSED_CONTEXT_CUSTOM_TYPE,
				content: renderPausedGoalContext(goal),
				display: false,
				details: { goalId: goal.goalId },
			},
		};
	}
	const current = goal.continuationPendingAt
		? (saveGoalOperation(
				runtimePi,
				{
					action: "continuation",
					goalId: goal.goalId,
					now: Date.now(),
					pending: false,
					phase: "started",
					reason: "Goal continuation started.",
					source: "runtime",
					explicitUserIntent: false,
					causedBy: "before-agent-start:clear-pending-continuation",
				},
				goal,
			) ?? goal)
		: goal;
	const observation = observeGoal({ context: protocolContext, goal: current });
	return {
		message: {
			customType: GOAL_CONTEXT_CUSTOM_TYPE,
			content: renderGoalContext(current),
			display: false,
			details: {
				goalId: current.goalId,
				capability: observation.allowed ? observation.data : undefined,
			},
		},
	};
}

export async function handleContext(
	event: ContextEvent,
	services: GoalRuntimeServices,
): Promise<{ messages: ContextEvent["messages"] }> {
	const { runtimePi, runtimeCtx, continuationGuard } = services;
	const goal = loadGoalState(runtimeCtx);
	retryPendingContinuation(runtimePi, runtimeCtx, continuationGuard, goal);
	const refreshed = loadGoalState(runtimeCtx);
	applyGoalUi(runtimeCtx, refreshed);
	return {
		messages: filterGoalContextMessages(event.messages, refreshed),
	};
}

export async function handleSessionBeforeCompact(
	event: SessionBeforeCompactEvent,
	runtimeCtx: GoalRuntimeContext,
): Promise<SessionBeforeCompactResult | undefined> {
	const goal = loadGoalState(runtimeCtx);
	resetGoalProtocolEpoch(runtimeCtx.goalProtocol);
	if (!isGoalActive(goal)) return undefined;
	const previous = event.preparation.previousSummary?.trim();
	const summary = [
		previous || "Conversation summary preserved by Pi.",
		renderGoalCompactionSummary(goal),
	]
		.filter(Boolean)
		.join("\n\n");

	return {
		compaction: {
			summary,
			firstKeptEntryId: event.preparation.firstKeptEntryId,
			tokensBefore: event.preparation.tokensBefore,
			details: { goalId: goal.goalId },
		},
	};
}

export async function handleSessionCompact(
	services: GoalRuntimeServices,
	event: CompactionResumeEvent,
): Promise<void> {
	const { runtimePi, runtimeCtx, continuationGuard, protocolContext } =
		services;
	resetGoalProtocolEpoch(protocolContext);
	const goal = loadGoalState(runtimeCtx);
	applyGoalUi(runtimeCtx, goal);
	if (!shouldResumeGoalAfterCompaction(goal, event, runtimeCtx)) return;
	queueGoalContinuation({
		ports: createPiContinuationPorts(runtimePi, runtimeCtx),
		ctx: runtimeCtx,
		guard: continuationGuard,
		goal,
		prompt: renderGoalContinuationPrompt(
			goal,
			"Context was compacted while an active goal remains. Continue from the persisted goal state instead of waiting for another user turn.",
		),
		reason: "Context compaction resume queued goal continuation.",
	});
}

export async function handleSessionStart(
	services: GoalRuntimeServices,
	event: SessionStartEvent,
): Promise<void> {
	const { runtimePi, runtimeCtx, continuationGuard, protocolContext } =
		services;
	resetGoalProtocolEpoch(protocolContext);
	const goal = loadGoalState(runtimeCtx);
	applyGoalUi(runtimeCtx, goal);
	if (
		shouldResumeGoalAfterSessionStart(
			goal,
			event,
			runtimeCtx,
			continuationGuard,
		)
	) {
		queueGoalContinuation({
			ports: createPiContinuationPorts(runtimePi, runtimeCtx),
			ctx: runtimeCtx,
			guard: continuationGuard,
			goal,
			prompt: renderGoalContinuationPrompt(
				goal,
				"Resumed with an active goal. Continue working toward it.",
			),
			reason: "Session resumed with an active goal.",
		});
		return;
	}

	const pendingGoal = loadGoalState(runtimeCtx);
	retryPendingContinuation(
		runtimePi,
		runtimeCtx,
		continuationGuard,
		pendingGoal,
	);
}

export async function handleSessionTree(
	services: GoalRuntimeServices,
): Promise<void> {
	const { runtimePi, runtimeCtx, continuationGuard, protocolContext } =
		services;
	resetGoalProtocolEpoch(protocolContext);
	const goal = loadGoalState(runtimeCtx);
	applyGoalUi(runtimeCtx, goal);
	retryPendingContinuation(runtimePi, runtimeCtx, continuationGuard, goal);
}

export async function handleAgentEndWithLock(
	services: GoalRuntimeServices,
	event: AgentEndEvent,
	lock: { evaluatingGoalId: string | null },
): Promise<void> {
	const { runtimeCtx } = services;
	const current = loadGoalState(runtimeCtx);
	if (!isGoalActive(current)) {
		applyGoalUi(runtimeCtx, current);
		return;
	}
	if (lock.evaluatingGoalId === current.goalId) return;

	lock.evaluatingGoalId = current.goalId;
	try {
		await handleAgentEnd(services, event);
	} finally {
		lock.evaluatingGoalId = null;
	}
}

async function handleAgentEnd(
	services: GoalRuntimeServices,
	event: AgentEndEvent,
): Promise<void> {
	const { runtimePi, runtimeCtx, continuationGuard } = services;
	try {
		const usage = collectUsage(event.messages);
		const latest = loadGoalState(runtimeCtx);
		if (!isGoalActive(latest)) return;

		const decision = await evaluateGoal(latest, runtimeCtx);
		const reason =
			decision.reason.trim() ||
			(decision.met
				? "Goal condition satisfied."
				: "Goal condition not yet satisfied.");
		const fresh = loadGoalState(runtimeCtx);
		if (
			!isGoalActive(fresh) ||
			fresh.goalId !== latest.goalId ||
			fresh.revision !== latest.revision
		) {
			applyGoalUi(runtimeCtx, fresh);
			runtimeCtx.ui?.notify?.(
				"Skipped stale goal evaluation because goal state changed during evaluation.",
				"warning",
			);
			return;
		}
		const evaluated = saveGoalOperation(
			runtimePi,
			{
				action: "evaluation",
				goalId: fresh.goalId,
				now: Date.now(),
				reason,
				usage,
				source: "runtime",
				explicitUserIntent: false,
				causedBy: "agent-end:evaluate-goal",
			},
			fresh,
		);
		if (!evaluated) {
			runtimeCtx.ui?.notify?.(
				"Goal evaluation did not persist state; skipping automatic continuation.",
				"warning",
			);
			return;
		}
		if (!ensureGoalStateInvariant(runtimeCtx, evaluated)) {
			pauseGoal({ runtimePi, runtimeCtx, continuationGuard }, evaluated, {
				reason: "error",
				message: "Persisted goal evaluation violated state invariants.",
				notification:
					"Goal paused because persisted evaluation state was invalid.",
			});
			return;
		}
		applyGoalUi(runtimeCtx, evaluated);
		if (!isGoalActive(evaluated)) return;

		const action = decideGoalNextAction(evaluated, decision);
		applyGoalAction(services, evaluated, action);
	} catch (error) {
		handleEvaluatorError(runtimePi, runtimeCtx, continuationGuard, error);
	}
}
