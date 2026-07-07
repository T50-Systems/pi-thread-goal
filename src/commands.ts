import {
	parseGoalEditDocument,
	parseTokenBudgetValue,
	renderGoalEditDocument,
} from "./goal-edit-document.js";
import { handleParsedGoalCommand, startGoal } from "./goal-command-handlers.js";
export { parseGoalEditDocument, parseTokenBudgetValue, renderGoalEditDocument };
export type { ParsedGoalEditDocument } from "./goal-edit-document.js";
export { startGoal };

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
