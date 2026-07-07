import { randomUUID } from "node:crypto";

import {
	createContinuationGuard,
	queueGoalContinuation,
} from "./continuation.js";
import {
	createPiContinuationStore,
	createPiMessageQueue,
	createPiNotifier,
} from "./pi-continuation-ports.js";
import { renderGoalStartPrompt } from "./prompts.js";
import { loadGoalState } from "./goal-state-persistence.js";
import { validateObjective } from "./goal-state.js";
import { saveGoalOperation } from "./goal-operations.js";
import {
	GOAL_USAGE,
	applyGoalUi,
	noGoalMessage,
	nonInteractiveConfirmationMessage,
	renderGoalSummary,
	renderGoalDoctor,
	setGoalWidgetExpanded,
	showGoalOverlay,
	toggleGoalWidgetExpanded,
} from "./ui.js";
import type { GoalState } from "./types.js";

// --- Goal edit document (pure parsing/rendering) ---

export interface ParsedGoalEditDocument {
	objective: string;
	acceptanceCriteria: string[];
	sourcePaths: string[];
	tokenBudget?: number;
}

export function renderGoalEditDocument(goal: GoalState): string {
	return [
		"Objective:",
		goal.objective,
		"",
		"Acceptance criteria:",
		...formatEditableList(goal.acceptanceCriteria),
		"",
		"Source paths:",
		...formatEditableList(goal.sourcePaths),
		"",
		"Token budget:",
		goal.tokenBudget ? String(goal.tokenBudget) : "",
	].join("\n");
}

export function parseGoalEditDocument(value: string): ParsedGoalEditDocument {
	const sections = splitGoalEditSections(value);
	if (sections.size === 0) {
		return { objective: value.trim(), acceptanceCriteria: [], sourcePaths: [] };
	}

	const tokenBudget = parseTokenBudgetValue(
		(sections.get("token budget") ?? []).join(" ").trim(),
	);
	return {
		objective: (sections.get("objective") ?? []).join("\n").trim(),
		acceptanceCriteria: parseEditableList(
			sections.get("acceptance criteria") ?? [],
		),
		sourcePaths: parseEditableList(sections.get("source paths") ?? []),
		...(tokenBudget === undefined ? {} : { tokenBudget }),
	};
}

export function parseTokenBudgetValue(
	value: string | undefined,
): number | undefined {
	const normalized = value?.trim().toLowerCase().replace(/[,_]/g, "");
	if (!normalized) return undefined;
	const match = normalized.match(/^(\d+(?:\.\d+)?)([km])?$/);
	if (!match) return undefined;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount) || amount <= 0) return undefined;
	let multiplier = 1;
	if (match[2] === "m") multiplier = 1_000_000;
	if (match[2] === "k") multiplier = 1_000;
	return Math.floor(amount * multiplier);
}

function splitGoalEditSections(value: string): Map<string, string[]> {
	const sections = new Map<string, string[]>();
	let current: string | undefined;

	for (const rawLine of value.split(/\r?\n/)) {
		const header = rawLine
			.trim()
			.match(/^(Objective|Acceptance criteria|Source paths|Token budget):$/i);
		if (header) {
			current = header[1].toLowerCase();
			sections.set(current, []);
			continue;
		}
		if (current) sections.get(current)?.push(rawLine);
	}

	return sections;
}

function formatEditableList(values: string[]): string[] {
	return values.length > 0 ? values.map((value) => `- ${value}`) : ["- "];
}

function parseEditableList(lines: string[]): string[] {
	return [
		...new Set(
			lines.map((line) => line.trim().replace(/^[-*]\s*/, "")).filter(Boolean),
		),
	];
}

// --- Command surface ---

export type GoalCommandKind =
	| "show"
	| "status"
	| "doctor"
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

export interface GoalCommandContext {
	hasUI: boolean;
	isIdle(): boolean;
	hasPendingMessages?(): boolean;
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

export interface GoalActionAPI {
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
	"doctor",
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
	if (first === "doctor") return { kind: "doctor", ...base };
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
	return handleParsedGoalCommand(pi, parseGoalCommand(args), ctx);
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

// --- Command handlers ---

export async function handleParsedGoalCommand(
	pi: GoalActionAPI,
	parsed: ParsedGoalCommand,
	ctx: GoalCommandContext,
): Promise<void> {
	if (parsed.kind === "show" || parsed.kind === "status") {
		await showGoalStatus(ctx);
		return;
	}
	if (parsed.kind === "doctor") {
		showGoalDoctor(ctx);
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

function showGoalDoctor(ctx: GoalCommandContext): void {
	const current = loadGoalState(ctx);
	if (!current) {
		ctx.ui.notify(noGoalMessage("doctor"), "warning");
		applyGoalUi(ctx, null);
		return;
	}
	applyGoalUi(ctx, current);
	ctx.ui.notify(
		renderGoalDoctor(current, {
			isIdle: readProbe(() => ctx.isIdle()),
			hasPendingMessages: readProbe(() => ctx.hasPendingMessages?.()),
		}),
		"info",
	);
}

function readProbe(probe: () => boolean | undefined): boolean | undefined {
	try {
		return probe();
	} catch {
		return undefined;
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
	ctx: Pick<GoalCommandContext, "isIdle" | "hasPendingMessages" | "ui">,
	goal: GoalState,
): void {
	const prompt = renderGoalStartPrompt(goal);
	const queued = queueGoalContinuation({
		ports: {
			store: createPiContinuationStore(pi, ctx),
			queue: createPiMessageQueue(pi),
			notifier: createPiNotifier(ctx),
		},
		ctx,
		guard: createContinuationGuard(),
		goal,
		prompt,
		reason: "Manual /goal start requested.",
		notification: "Goal turn started.",
	});
	if (!queued) {
		ctx.ui.notify("Goal turn could not be started automatically.", "warning");
	}
}
