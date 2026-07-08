import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { saveGoalOperation } from "./goal-operations.js";
import type {
	GoalProtocolContextSource,
	GoalProtocolDecision,
} from "./goal-protocol.js";
import {
	authorizeGoalCompletion,
	authorizeProgressUpdate,
	observeGoal,
	prepareGoalCompletion,
	requireGoalProtocolContext,
} from "./goal-protocol.js";
import { validateObjective } from "./goal-state.js";
import { loadGoalState } from "./goal-state-persistence.js";
import {
	getNonOperationalBlockers,
	validateGoalCompletion,
	validateGoalProgressUpdate,
} from "./policies.js";
import type { GoalProgress, GoalState } from "./types.js";

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
		done: Type.Optional(
			Type.Array(Type.String(), {
				description: "Completed work items with concrete evidence.",
			}),
		),
		current: Type.Optional(
			Type.String({
				description: "The next/current actionable work item.",
			}),
		),
		blocked: Type.Optional(
			Type.Array(Type.String(), {
				description:
					"Real operational blockers only: no useful next action remains without user, runtime, or external input. Do not list risks or uncertainty here.",
			}),
		),
		summary: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

interface GoalToolContext extends GoalProtocolContextSource {
	sessionManager: {
		getBranch(): Array<{ type: string; customType?: string; data?: unknown }>;
		sessionId?: string;
		leafId?: string | null;
	};
}

export function registerGoalTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "get_goal",
		label: "Get Goal",
		description:
			"Read the current /goal state and register a fresh protocol observation capability.",
		promptSnippet:
			"Call get_goal immediately before update_goal_progress, prepare_goal_completion, or complete_goal; call it again after any goal mutation before the next mutation.",
		promptGuidelines: [
			"Use get_goal only when the persisted /goal state is needed; do not narrate the internal lookup to the user.",
			"Every goal-state mutation needs a fresh observation for the current goal revision: get_goal -> update_goal_progress, and after update_goal_progress call get_goal again before prepare_goal_completion or complete_goal.",
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
			"Call get_goal in this same turn before prepare_goal_completion; if update_goal_progress just ran, call get_goal again first.",
		promptGuidelines: [
			"Use prepare_goal_completion only when evidence shows the current objective is complete.",
			"Call get_goal immediately before prepare_goal_completion unless you have already observed the current goal revision after the last mutation.",
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
			"Use complete_goal only after get_goal and prepare_goal_completion succeed for the same current goal revision and evidence.",
		promptGuidelines: [
			"Completion flow is get_goal -> prepare_goal_completion with evidence -> complete_goal with the same evidence.",
			"If update_goal_progress ran earlier in the turn, call get_goal again before prepare_goal_completion because progress updates change the goal revision.",
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
			"Use update_goal_progress only immediately after get_goal has observed the active goal in this same turn.",
		promptGuidelines: [
			"Mutation flow is get_goal -> update_goal_progress. Do not call update_goal_progress from stale goal context alone.",
			"After update_goal_progress succeeds, call get_goal again before any later prepare_goal_completion, complete_goal, or update_goal_progress call because the revision changed.",
			"Use update_goal_progress to update done/current/blocked/summary for the active goal.",
			"Use blocked only for real operational blockers: no useful next action remains without a user, runtime, or external decision. Put risks, uncertainty, and difficult-but-actionable work in current/summary instead.",
			"For ongoing batch goals, after noting progress choose the next unfinished item and continue rather than giving a status-only response.",
			"Do not use update_goal_progress to rewrite the goal objective itself.",
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
			const nonOperationalBlockers = getNonOperationalBlockers(
				progress.progress.blocked,
			);
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
				details: {
					goal: next,
					protocol: protocolDetails(decision),
					blockerWarning: nonOperationalBlockers.length
						? {
								message:
									"Some blocked entries look like technical risk or actionable uncertainty; keep those in current/summary unless no useful next action remains.",
								items: nonOperationalBlockers,
							}
						: undefined,
				},
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
