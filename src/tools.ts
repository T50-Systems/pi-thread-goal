import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { validateGoalCompletion } from "./completion-policy.js";
import { requireGoalProtocolContext } from "./goal-protocol-context.js";
import { validateGoalProgressUpdate } from "./goal-progress-policy.js";
import { saveGoalOperation } from "./goal-operation-workflow.js";
import {
	authorizeGoalCompletion,
	authorizeProgressUpdate,
	observeGoal,
	prepareGoalCompletion,
} from "./goal-protocol-policy.js";
import { loadGoalState } from "./goal-state-persistence.js";
import { validateObjective } from "./goal-state.js";
import type { GoalProgress, GoalState } from "./types.js";
import type { GoalProtocolDecision } from "./goal-protocol-types.js";
import type { GoalProtocolContextSource } from "./goal-protocol-context.js";

export { validateGoalCompletion };

const getGoalParams = Type.Object({}, { additionalProperties: false });
const createGoalParams = Type.Object(
	{
		objective: Type.String({
			description: "The concrete user-approved objective to start pursuing.",
		}),
		explicit_request: Type.Boolean({
			description:
				"Must be true only when the user or system/developer instructions explicitly requested a goal.",
		}),
		acceptance_criteria: Type.Optional(Type.Array(Type.String())),
		source_paths: Type.Optional(Type.Array(Type.String())),
	},
	{ additionalProperties: false },
);
const prepareGoalCompletionParams = Type.Object(
	{
		evidence: Type.String({ description: "Completion evidence to validate." }),
	},
	{ additionalProperties: false },
);
const completeGoalParams = Type.Object(
	{
		evidence: Type.String({
			description:
				"Same completion evidence that was prepared by prepare_goal_completion.",
		}),
	},
	{ additionalProperties: false },
);
const updateGoalProgressParams = Type.Object(
	{
		done: Type.Optional(Type.Array(Type.String())),
		current: Type.Optional(Type.String()),
		blocked: Type.Optional(Type.Array(Type.String())),
		summary: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

interface GoalToolContext extends GoalProtocolContextSource {
	sessionManager: {
		getBranch(): Array<{ type: string; customType?: string; data?: unknown }>;
	};
}

export function registerGoalTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "get_goal",
		label: "Get Goal",
		description:
			"Read the current /goal state and register a fresh protocol observation capability.",
		promptSnippet:
			"Use get_goal before mutating a goal when you do not already have a fresh observation in this context.",
		promptGuidelines: [
			"Use get_goal only when the persisted /goal state is needed; do not narrate the internal lookup to the user.",
			"After get_goal observes an active goal, update_goal_progress and prepare_goal_completion can use the internal observation capability for this context.",
		],
		parameters: getGoalParams,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const toolCtx = ctx as GoalToolContext;
			const current = loadGoalState(toolCtx);
			const protocolContext = requireGoalProtocolContext(toolCtx);
			const decision = observeGoal({ context: protocolContext, goal: current });
			return {
				content: [
					{
						type: "text",
						text: current ? formatGoal(current) : "No goal is currently set.",
					},
				],
				details: {
					goal: current,
					capability: decision.allowed ? decision.data : undefined,
					protocol: protocolDetails(decision),
				},
			};
		},
	});

	pi.registerTool({
		name: "create_goal",
		label: "Create Goal",
		description:
			"Create a goal only when explicitly requested by the user or system/developer instructions.",
		promptSnippet:
			"Use create_goal only for an explicitly requested new /goal.",
		promptGuidelines: [
			"Use create_goal only when the user or higher-priority instructions explicitly ask to create a goal.",
			"Use create_goal only when no active or paused goal already exists.",
		],
		parameters: createGoalParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!params.explicit_request) {
				throw new Error("create_goal requires explicit_request=true.");
			}
			const current = loadGoalState(ctx as GoalToolContext);
			if (current) {
				throw new Error(
					"A goal already exists. Replace it only through an explicit user command.",
				);
			}
			const next = saveGoalOperation(
				pi,
				{
					action: "create",
					goalId: crypto.randomUUID(),
					objective: validateObjective(params.objective),
					now: Date.now(),
					acceptanceCriteria: params.acceptance_criteria,
					sourcePaths: params.source_paths,
					source: "model-tool",
					explicitUserIntent: true,
					causedBy: "create_goal",
				},
				current,
			);
			return {
				content: [
					{ type: "text", text: next ? "Goal created." : "Goal not created." },
				],
				details: { goal: next },
			};
		},
	});

	pi.registerTool({
		name: "prepare_goal_completion",
		label: "Prepare Goal Completion",
		description:
			"Validate completion evidence and register a short-lived completion candidate.",
		promptSnippet:
			"Call prepare_goal_completion with evidence before complete_goal.",
		promptGuidelines: [
			"Use prepare_goal_completion only when evidence shows the current objective is complete.",
			"Do not call complete_goal until prepare_goal_completion succeeds for the same evidence.",
		],
		parameters: prepareGoalCompletionParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const toolCtx = ctx as GoalToolContext;
			const current = loadGoalState(toolCtx);
			const protocolContext = requireGoalProtocolContext(toolCtx);
			const decision = prepareGoalCompletion({
				context: protocolContext,
				goal: current,
				evidence: params.evidence,
			});
			if (!decision.allowed) throw new Error(decision.reason);
			return {
				content: [{ type: "text", text: "Goal completion prepared." }],
				details: {
					goal: current,
					capability: decision.data,
					protocol: protocolDetails(decision),
				},
			};
		},
	});

	pi.registerTool({
		name: "complete_goal",
		label: "Complete Goal",
		description:
			"Mark the active goal complete only with a fresh internal completion candidate.",
		promptSnippet:
			"Use complete_goal only after prepare_goal_completion succeeds for the same evidence.",
		promptGuidelines: [
			"Call get_goal, then prepare_goal_completion with evidence, then complete_goal with the same evidence.",
			"Do not use complete_goal to stop work early or to pause a goal.",
			"Resolve blockers and update current progress before preparing completion.",
		],
		parameters: completeGoalParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const toolCtx = ctx as GoalToolContext;
			const current = loadGoalState(toolCtx);
			const protocolContext = requireGoalProtocolContext(toolCtx);
			const decision = authorizeGoalCompletion({
				context: protocolContext,
				goal: current,
				evidence: params.evidence,
			});
			if (!decision.allowed) throw new Error(decision.reason);
			if (!current)
				throw new Error("Goal disappeared after protocol authorization.");
			const evidence = params.evidence.trim();
			const next = saveGoalOperation(
				pi,
				{
					action: "complete",
					goalId: current.goalId,
					now: Date.now(),
					evidence,
					source: "model-tool",
					explicitUserIntent: false,
					causedBy: "complete_goal",
				},
				current,
			);
			return {
				content: [
					{
						type: "text",
						text: next ? "Goal completed." : "Goal not completed.",
					},
				],
				details: { goal: next, protocol: protocolDetails(decision) },
				terminate: Boolean(next && next.status === "complete"),
			};
		},
	});

	pi.registerTool({
		name: "update_goal_progress",
		label: "Update Goal Progress",
		description:
			"Update execution progress for the active goal with a fresh internal observation capability.",
		promptSnippet:
			"Use update_goal_progress after get_goal has observed the active goal in this context.",
		promptGuidelines: [
			"Use update_goal_progress to update done/current/blocked/summary for the active goal.",
			"Do not use update_goal_progress to rewrite the goal objective itself.",
			"Call get_goal first if this context has not freshly observed the goal.",
		],
		parameters: updateGoalProgressParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const toolCtx = ctx as GoalToolContext;
			const current = loadGoalState(toolCtx);
			const protocolContext = requireGoalProtocolContext(toolCtx);
			const decision = authorizeProgressUpdate({
				context: protocolContext,
				goal: current,
			});
			if (!decision.allowed) throw new Error(decision.reason);
			if (!current)
				throw new Error("Goal disappeared after protocol authorization.");
			const patch = normalizeProgressInput(params);
			const progress = validateGoalProgressUpdate(current.progress, patch);
			if (!progress.ok) throw new Error(progress.reason);
			const next = saveGoalOperation(
				pi,
				{
					action: "progress",
					goalId: current.goalId,
					now: Date.now(),
					progress: progress.progress,
					source: "model-tool",
					explicitUserIntent: false,
					causedBy: "update_goal_progress",
				},
				current,
			);
			return {
				content: [
					{
						type: "text",
						text: next
							? formatGoalProgressUpdate(next)
							: "Progress not updated.",
					},
				],
				details: { goal: next, protocol: protocolDetails(decision) },
			};
		},
	});
}

function normalizeProgressInput(params: {
	done?: string[];
	current?: string;
	blocked?: string[];
	summary?: string;
}): Partial<GoalProgress> {
	return {
		done: params.done,
		current: params.current,
		blocked: params.blocked,
		summary: params.summary,
	};
}

function protocolDetails(decision: GoalProtocolDecision<unknown>) {
	return decision.allowed
		? {
				allowed: true,
				state: decision.state,
				output: decision.output,
				expiresAt: decision.capability?.expiresAt,
			}
		: {
				allowed: false,
				state: decision.state,
				output: decision.output,
				code: decision.code,
				reason: decision.reason,
			};
}

export function formatGoal(goal: GoalState): string {
	return [
		`/goal ${goal.status}`,
		goal.progress.current ? `Now: ${goal.progress.current}` : undefined,
		`Progress: ${goal.progress.summary || "No progress recorded yet."}`,
		goal.progress.blocked.length > 0
			? `Blocked: ${goal.progress.blocked.join("; ")}`
			: undefined,
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}

export function formatGoalProgressUpdate(_goal: GoalState): string {
	return "Progress noted.";
}
