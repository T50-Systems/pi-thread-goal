import { randomUUID } from "node:crypto";

import {
	parseGoalEditDocument,
	parseTokenBudgetValue,
	renderGoalEditDocument,
} from "./goal-edit-document.js";
export { parseGoalEditDocument, parseTokenBudgetValue, renderGoalEditDocument };
export type { ParsedGoalEditDocument } from "./goal-edit-document.js";
import { renderGoalStartPrompt } from "./prompts.js";
import { loadGoalState, saveGoalState, validateObjective } from "./state.js";
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

export type GoalCommandKind =
	| "show"
	| "status"
	| "create"
	| "edit"
	| "pause"
	| "resume"
	| "start"
	| "clear"
	| "complete"
	| "dismiss"
	| "toggle"
	| "expand"
	| "collapse";

export interface ParsedGoalCommand {
	kind: GoalCommandKind;
	objective?: string;
	confirmed: boolean;
	replace: boolean;
	start: boolean;
	tokenBudget?: number;
}

interface GoalCommandContext {
	hasUI: boolean;
	isIdle(): boolean;
	waitForIdle(): Promise<void>;
	sessionManager: {
		getBranch(): Array<{ type: string; customType?: string; data?: unknown }>;
	};
	ui: {
		notify(message: string, level?: "info" | "warning" | "error"): void;
		confirm(title: string, message: string): Promise<boolean>;
		editor(title: string, initialValue: string): Promise<string | undefined>;
		setStatus(key: string, value: string | undefined): void;
		setWidget(key: string, value: string[] | undefined): void;
		custom?<T>(
			factory: (
				tui: { requestRender(): void },
				theme: unknown,
				keybindings: unknown,
				done: (result: T) => void,
			) => {
				render(width: number): string[];
				invalidate(): void;
				handleInput?(data: string): void;
			},
			options?: { overlay?: boolean; overlayOptions?: Record<string, unknown> },
		): Promise<T>;
	};
}

interface GoalActionAPI {
	appendEntry(customType: string, data?: unknown): unknown;
	sendUserMessage(prompt: string, options?: { deliverAs: "followUp" }): unknown;
}

interface ExtensionAPI extends GoalActionAPI {
	registerCommand(
		name: string,
		command: {
			description: string;
			getArgumentCompletions?: (
				prefix: string,
			) => Array<{ value: string; label: string }> | null;
			handler: (args: string, ctx: unknown) => Promise<void>;
		},
	): void;
}

const CONTROL_COMMANDS = [
	"status",
	"edit",
	"pause",
	"resume",
	"start",
	"clear",
	"complete",
	"dismiss",
	"toggle",
	"expand",
	"collapse",
];
const RECOGNIZED_FLAGS = new Set([
	"--yes",
	"-y",
	"--replace",
	"--start",
	"--no-start",
]);

export function registerGoalCommand(pi: ExtensionAPI): void {
	pi.registerCommand("goal", {
		description: "Set or view the goal for a long-running task",
		getArgumentCompletions: (prefix) => {
			const items = CONTROL_COMMANDS.filter((command) =>
				command.startsWith(prefix),
			);
			return items.length > 0
				? items.map((value) => ({ value, label: value }))
				: null;
		},
		handler: async (args, ctx) =>
			handleGoalCommand(pi, args, ctx as GoalCommandContext),
	});
}

export function parseGoalCommand(args: string): ParsedGoalCommand {
	const trimmed = args.trim();
	if (!trimmed)
		return { kind: "show", confirmed: false, replace: false, start: false };

	const rawTokens = trimmed.split(/\s+/);
	const tokenBudget = parseTokenBudgetFlag(rawTokens);
	const tokens = stripTokenBudgetFlag(rawTokens);
	const first = tokens[0] ?? "";
	const confirmed = tokens.includes("--yes") || tokens.includes("-y");
	const replace = tokens.includes("--replace");
	const start =
		first === "resume"
			? !tokens.includes("--no-start")
			: tokens.includes("--start");
	const base = {
		confirmed,
		replace,
		start,
		...(tokenBudget === undefined ? {} : { tokenBudget }),
	};

	if (first === "status") return { kind: "status", ...base };
	if (first === "edit") return { kind: "edit", ...base };
	if (first === "pause") return { kind: "pause", ...base };
	if (first === "resume") return { kind: "resume", ...base };
	if (first === "start") return { kind: "start", ...base, start: true };
	if (first === "clear") return { kind: "clear", ...base };
	if (first === "complete") return { kind: "complete", ...base };
	if (first === "dismiss") return { kind: "dismiss", ...base };
	if (first === "toggle") return { kind: "toggle", ...base };
	if (first === "expand") return { kind: "expand", ...base };
	if (first === "collapse") return { kind: "collapse", ...base };

	if (["clear", "stop", "off", "reset", "none", "cancel"].includes(first)) {
		return { kind: "clear", ...base };
	}

	const objective = tokens
		.filter((token) => !RECOGNIZED_FLAGS.has(token))
		.join(" ")
		.trim();
	return { kind: "create", objective, ...base };
}

export async function handleGoalCommand(
	pi: GoalActionAPI,
	args: string,
	ctx: GoalCommandContext,
): Promise<void> {
	const parsed = parseGoalCommand(args);

	if (parsed.kind === "show" || parsed.kind === "status") {
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
		return;
	}

	if (
		parsed.kind === "toggle" ||
		parsed.kind === "expand" ||
		parsed.kind === "collapse"
	) {
		const current = loadGoalState(ctx);
		if (!current) {
			ctx.ui.notify(noGoalMessage(parsed.kind), "warning");
			applyGoalUi(ctx, null);
			return;
		}
		let expanded: boolean;
		if (parsed.kind === "toggle") {
			expanded = toggleGoalWidgetExpanded();
		} else if (parsed.kind === "expand") {
			setGoalWidgetExpanded(true);
			expanded = true;
		} else {
			setGoalWidgetExpanded(false);
			expanded = false;
		}
		applyGoalUi(ctx, current);
		ctx.ui.notify(
			`Goal widget ${expanded ? "expanded" : "collapsed"}.`,
			"info",
		);
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
		case "pause": {
			if (!current) {
				ctx.ui.notify(noGoalMessage("pause"), "error");
				return;
			}
			const next = saveGoalState(
				pi,
				{ action: "pause", goalId: current.goalId, now: Date.now() },
				current,
			);
			applyGoalUi(ctx, next);
			ctx.ui.notify("Goal paused.", "info");
			return;
		}
		case "resume": {
			if (!current) {
				ctx.ui.notify(noGoalMessage("resume"), "error");
				return;
			}
			const next = saveGoalState(
				pi,
				{ action: "resume", goalId: current.goalId, now: Date.now() },
				current,
			);
			applyGoalUi(ctx, next);
			ctx.ui.notify("Goal resumed.", "info");
			if (next && parsed.start) {
				startGoal(pi, ctx, next);
			}
			return;
		}
		case "start": {
			if (!current) {
				ctx.ui.notify(noGoalMessage("start"), "error");
				return;
			}
			startGoal(pi, ctx, current);
			return;
		}
		case "clear": {
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
			const next = saveGoalState(
				pi,
				{ action: "clear", goalId: current.goalId, now: Date.now() },
				current,
			);
			applyGoalUi(ctx, next);
			ctx.ui.notify("Goal cleared.", "info");
			return;
		}
		case "complete": {
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
			const next = saveGoalState(
				pi,
				{ action: "complete", goalId: current.goalId, now: Date.now() },
				current,
			);
			applyGoalUi(ctx, next);
			ctx.ui.notify("Goal marked complete.", "info");
			return;
		}
		case "dismiss": {
			if (!current) {
				ctx.ui.notify(noGoalMessage("dismiss"), "warning");
				return;
			}
			const next = saveGoalState(
				pi,
				{ action: "dismiss", goalId: current.goalId, now: Date.now() },
				current,
			);
			applyGoalUi(ctx, next);
			ctx.ui.notify("Goal widget dismissed.", "info");
			return;
		}
		default:
			return;
	}
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
			}
		: {
				action: "create" as const,
				goalId: randomUUID(),
				objective,
				tokenBudget: parsed.tokenBudget,
				now: Date.now(),
			};

	const next = saveGoalState(pi, event, current);
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
	const next = saveGoalState(
		pi,
		{
			action: "edit",
			goalId: current.goalId,
			objective: validateObjective(parsed.objective),
			acceptanceCriteria: parsed.acceptanceCriteria,
			sourcePaths: parsed.sourcePaths,
			tokenBudget: parsed.tokenBudget,
			now: Date.now(),
		},
		current,
	);
	applyGoalUi(ctx, next);
	ctx.ui.notify("Goal updated.", "info");
}

function parseTokenBudgetFlag(tokens: string[]): number | undefined {
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "--tokens") return parseTokenBudgetValue(tokens[i + 1]);
		if (token?.startsWith("--tokens="))
			return parseTokenBudgetValue(token.slice("--tokens=".length));
	}
	return undefined;
}

function stripTokenBudgetFlag(tokens: string[]): string[] {
	const result: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "--tokens") {
			i++;
			continue;
		}
		if (token?.startsWith("--tokens=")) continue;
		result.push(token);
	}
	return result;
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
