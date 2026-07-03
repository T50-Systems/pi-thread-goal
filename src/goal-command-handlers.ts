import { randomUUID } from "node:crypto";

import {
	parseGoalEditDocument,
	renderGoalEditDocument,
} from "./goal-edit-document.js";
import { renderGoalStartPrompt } from "./prompts.js";
import { loadGoalState, validateObjective } from "./state.js";
import { saveGoalOperation } from "./goal-operation-workflow.js";
import {
	GOAL_USAGE,
	applyGoalUi,
	noGoalMessage,
	nonInteractiveConfirmationMessage,
	renderGoalSummary,
	setGoalWidgetExpanded,
	showGoalOverlay,
	toggleGoalWidgetExpanded,
} from "./ui.js";
import type { GoalState } from "./types.js";
import type {
	GoalActionAPI,
	GoalCommandContext,
	ParsedGoalCommand,
} from "./commands.js";

export async function handleParsedGoalCommand(
	pi: GoalActionAPI,
	parsed: ParsedGoalCommand,
	ctx: GoalCommandContext,
): Promise<void> {
	if (parsed.kind === "show" || parsed.kind === "status") {
		await showGoalStatus(ctx);
		return;
	}

	if (isWidgetCommand(parsed.kind)) {
		handleWidgetCommand(ctx, parsed.kind);
		return;
	}

	await ctx.waitForIdle();
	const current = loadGoalState(ctx);

	switch (parsed.kind) {
		case "create":
			await createOrReplaceGoal(pi, ctx, parsed, current);
			return;
		case "edit":
			await editGoal(pi, ctx, current);
			return;
		case "pause":
			handlePauseGoal(pi, ctx, current);
			return;
		case "resume":
			handleResumeGoal(pi, ctx, parsed, current);
			return;
		case "start":
			handleStartGoal(pi, ctx, current);
			return;
		case "clear":
			await handleClearGoal(pi, ctx, parsed, current);
			return;
		case "complete":
			await handleCompleteGoal(pi, ctx, parsed, current);
			return;
		case "dismiss":
			handleDismissGoal(pi, ctx, current);
			return;
		default:
			return;
	}
}

async function showGoalStatus(ctx: GoalCommandContext): Promise<void> {
	const current = loadGoalState(ctx);
	if (!current) {
		ctx.ui.notify(GOAL_USAGE, "info");
		applyGoalUi(ctx, null);
		return;
	}
	applyGoalUi(ctx, current);
	if (ctx.hasUI && ctx.ui.custom) {
		await showGoalOverlay(ctx, current);
	} else {
		ctx.ui.notify(renderGoalSummary(current), "info");
	}
}

function isWidgetCommand(
	kind: ParsedGoalCommand["kind"],
): kind is Extract<
	ParsedGoalCommand["kind"],
	"toggle" | "expand" | "collapse"
> {
	return kind === "toggle" || kind === "expand" || kind === "collapse";
}

function handleWidgetCommand(
	ctx: GoalCommandContext,
	kind: Extract<ParsedGoalCommand["kind"], "toggle" | "expand" | "collapse">,
): void {
	const current = loadGoalState(ctx);
	if (!current) {
		ctx.ui.notify(noGoalMessage(kind), "warning");
		applyGoalUi(ctx, null);
		return;
	}
	let expanded: boolean;
	if (kind === "toggle") {
		expanded = toggleGoalWidgetExpanded();
	} else if (kind === "expand") {
		setGoalWidgetExpanded(true);
		expanded = true;
	} else {
		setGoalWidgetExpanded(false);
		expanded = false;
	}
	applyGoalUi(ctx, current);
	ctx.ui.notify(`Goal widget ${expanded ? "expanded" : "collapsed"}.`, "info");
}

async function createOrReplaceGoal(
	pi: GoalActionAPI,
	ctx: GoalCommandContext,
	parsed: ParsedGoalCommand,
	current: GoalState | null,
): Promise<void> {
	const objective = validateObjective(parsed.objective ?? "");

	if (current && !parsed.replace) {
		if (!ctx.hasUI) {
			ctx.ui.notify(
				nonInteractiveConfirmationMessage("/goal <objective>"),
				"error",
			);
			return;
		}
		const ok = await ctx.ui.confirm(
			"Replace current goal?",
			current.objective + "\n\nNew goal:\n" + objective,
		);
		if (!ok) {
			ctx.ui.notify("Goal replacement cancelled.", "info");
			return;
		}
	}

	const event = current
		? {
				action: "replace" as const,
				goalId: randomUUID(),
				objective,
				tokenBudget: parsed.tokenBudget,
				now: Date.now(),
				source: "user-command" as const,
				explicitUserIntent: true,
				causedBy: "/goal create --replace",
			}
		: {
				action: "create" as const,
				goalId: randomUUID(),
				objective,
				tokenBudget: parsed.tokenBudget,
				now: Date.now(),
				source: "user-command" as const,
				explicitUserIntent: true,
				causedBy: "/goal create",
			};

	const next = saveGoalOperation(pi, event, current);
	applyGoalUi(ctx, next);
	ctx.ui.notify(current ? "Goal replaced." : "Goal created.", "info");
	if (next) {
		startGoal(pi, ctx, next);
	}
}

async function editGoal(
	pi: GoalActionAPI,
	ctx: GoalCommandContext,
	current: GoalState | null,
): Promise<void> {
	if (!current) {
		ctx.ui.notify(noGoalMessage("edit"), "error");
		return;
	}
	if (!ctx.hasUI) {
		ctx.ui.notify(
			"/goal edit requires interactive UI. Use /goal <objective> --replace instead.",
			"error",
		);
		return;
	}

	const edited = await ctx.ui.editor(
		"Edit goal",
		renderGoalEditDocument(current),
	);
	if (edited === undefined) {
		ctx.ui.notify("Goal edit cancelled.", "info");
		return;
	}

	const parsed = parseGoalEditDocument(edited);
	const next = saveGoalOperation(
		pi,
		{
			action: "edit",
			goalId: current.goalId,
			objective: validateObjective(parsed.objective),
			acceptanceCriteria: parsed.acceptanceCriteria,
			sourcePaths: parsed.sourcePaths,
			tokenBudget: parsed.tokenBudget,
			now: Date.now(),
			source: "user-command",
			explicitUserIntent: true,
			causedBy: "/goal edit",
		},
		current,
	);
	applyGoalUi(ctx, next);
	ctx.ui.notify("Goal updated.", "info");
}

function handlePauseGoal(
	pi: GoalActionAPI,
	ctx: GoalCommandContext,
	current: GoalState | null,
): void {
	if (!current) {
		ctx.ui.notify(noGoalMessage("pause"), "error");
		return;
	}
	const next = saveGoalOperation(
		pi,
		{
			action: "pause",
			goalId: current.goalId,
			now: Date.now(),
			source: "user-command",
			explicitUserIntent: true,
			causedBy: "/goal pause",
		},
		current,
	);
	applyGoalUi(ctx, next);
	ctx.ui.notify("Goal paused.", "info");
}

function handleResumeGoal(
	pi: GoalActionAPI,
	ctx: GoalCommandContext,
	parsed: ParsedGoalCommand,
	current: GoalState | null,
): void {
	if (!current) {
		ctx.ui.notify(noGoalMessage("resume"), "error");
		return;
	}
	const next = saveGoalOperation(
		pi,
		{
			action: "resume",
			goalId: current.goalId,
			now: Date.now(),
			source: "user-command",
			explicitUserIntent: true,
			causedBy: "/goal resume",
		},
		current,
	);
	applyGoalUi(ctx, next);
	ctx.ui.notify("Goal resumed.", "info");
	if (next && parsed.start) {
		startGoal(pi, ctx, next);
	}
}

function handleStartGoal(
	pi: GoalActionAPI,
	ctx: GoalCommandContext,
	current: GoalState | null,
): void {
	if (!current) {
		ctx.ui.notify(noGoalMessage("start"), "error");
		return;
	}
	startGoal(pi, ctx, current);
}

async function handleClearGoal(
	pi: GoalActionAPI,
	ctx: GoalCommandContext,
	parsed: ParsedGoalCommand,
	current: GoalState | null,
): Promise<void> {
	if (!current) {
		ctx.ui.notify(noGoalMessage("clear"), "warning");
		return;
	}
	const ok = await confirmAction(
		ctx,
		parsed.confirmed,
		"Clear goal?",
		"/goal clear",
	);
	if (!ok) return;
	const next = saveGoalOperation(
		pi,
		{
			action: "clear",
			goalId: current.goalId,
			now: Date.now(),
			source: "user-command",
			explicitUserIntent: true,
			causedBy: "/goal clear",
		},
		current,
	);
	applyGoalUi(ctx, next);
	ctx.ui.notify("Goal cleared.", "info");
}

async function handleCompleteGoal(
	pi: GoalActionAPI,
	ctx: GoalCommandContext,
	parsed: ParsedGoalCommand,
	current: GoalState | null,
): Promise<void> {
	if (!current) {
		ctx.ui.notify(noGoalMessage("complete"), "warning");
		return;
	}
	const ok = await confirmAction(
		ctx,
		parsed.confirmed,
		"Mark goal complete?",
		"/goal complete",
	);
	if (!ok) return;
	const next = saveGoalOperation(
		pi,
		{
			action: "complete",
			goalId: current.goalId,
			now: Date.now(),
			source: "user-command",
			explicitUserIntent: true,
			causedBy: "/goal complete",
		},
		current,
	);
	applyGoalUi(ctx, next);
	ctx.ui.notify("Goal marked complete.", "info");
}

function handleDismissGoal(
	pi: GoalActionAPI,
	ctx: GoalCommandContext,
	current: GoalState | null,
): void {
	if (!current) {
		ctx.ui.notify(noGoalMessage("dismiss"), "warning");
		return;
	}
	const next = saveGoalOperation(
		pi,
		{
			action: "dismiss",
			goalId: current.goalId,
			now: Date.now(),
			source: "user-command",
			explicitUserIntent: true,
			causedBy: "/goal dismiss",
		},
		current,
	);
	applyGoalUi(ctx, next);
	ctx.ui.notify("Goal widget dismissed.", "info");
}

async function confirmAction(
	ctx: GoalCommandContext,
	alreadyConfirmed: boolean,
	title: string,
	command: string,
): Promise<boolean> {
	if (alreadyConfirmed) return true;
	if (!ctx.hasUI) {
		ctx.ui.notify(nonInteractiveConfirmationMessage(command), "error");
		return false;
	}
	return ctx.ui.confirm(title, "This action changes the current goal state.");
}

export function startGoal(
	pi: GoalActionAPI,
	ctx: Pick<GoalCommandContext, "isIdle" | "ui">,
	goal: GoalState,
): void {
	const prompt = renderGoalStartPrompt(goal);
	if (ctx.isIdle()) {
		pi.sendUserMessage(prompt);
	} else {
		pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	}
	ctx.ui.notify("Goal turn started.", "info");
}
