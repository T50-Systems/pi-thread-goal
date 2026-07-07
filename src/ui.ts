
export function visibleWidth(value: string): number {
	return stripAnsi(value).length;
}

export function truncateToVisibleWidth(value: string, width: number): string {
	const plain = stripAnsi(value);
	return plain.length <= width ? value : plain.slice(0, Math.max(0, width));
}

export function wrapPlainText(value: string, width: number): string[] {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (!normalized) return [""];
	if (width <= 1) return normalized.split("").slice(0, 200);

	const words = normalized.split(" ");
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		if (!current) {
			current = word;
			continue;
		}
		if (`${current} ${word}`.length <= width) {
			current = `${current} ${word}`;
			continue;
		}
		lines.push(current);
		if (word.length <= width) {
			current = word;
			continue;
		}
		const chunks = chunkText(word, width);
		lines.push(...chunks.slice(0, -1));
		current = chunks.at(-1) ?? "";
	}

	if (current) lines.push(current);
	return lines;
}

export function summarizeList(values: string[]): string {
	if (values.length <= 2) return values.join("; ");
	return `${values[0]}; ${values[1]}; +${values.length - 2} more`;
}

export function formatElapsedTime(startedAt: number, now = Date.now()): string {
	const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
	const days = Math.floor(totalSeconds / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	return [
		days > 0 ? `${days}d` : undefined,
		hours > 0 || days > 0 ? `${hours}h` : undefined,
		minutes > 0 || hours > 0 || days > 0 ? `${minutes}m` : undefined,
		`${seconds}s`,
	]
		.filter((part): part is string => Boolean(part))
		.join(" ");
}

export function truncate(value: string, max = 72): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length <= max
		? normalized
		: `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

export function formatTokenSpend(goal: GoalState): string {
	const used = formatCompactNumber(goal.usage.total);
	return goal.tokenBudget
		? `${used}/${formatCompactNumber(goal.tokenBudget)}`
		: used;
}

function chunkText(value: string, width: number): string[] {
	const chunks: string[] = [];
	for (let i = 0; i < value.length; i += width)
		chunks.push(value.slice(i, i + width));
	return chunks;
}

function stripAnsi(value: string): string {
	return value.replace(/\x1B\[[0-9;]*m/g, "");
}

function formatCompactNumber(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
}

import {
	getContinuationRetryDelayMs,
	hasReachedContinuationDeliveryLimit,
	hasStalePendingContinuation,
	MAX_CONTINUATION_DELIVERY_ATTEMPTS,
} from "./continuation.js";
import type { GoalState } from "./types.js";

let goalWidgetExpanded = false;
const GOAL_WIDGET_BG = "\x1b[48;5;236m";
const GOAL_WIDGET_FG = "\x1b[38;5;250m";
const GOAL_WIDGET_ACCENT = "\x1b[38;5;153m";
const ANSI_RESET = "\x1b[0m";

export const GOAL_USAGE = [
	"Usage:",
	"  /goal <objective> [--tokens 100k]",
	"  /goal status",
	"  /goal doctor",
	"  /goal edit",
	"  /goal pause|resume [--no-start]",
	"  /goal start",
	"  /goal clear [--yes]",
	"  /goal complete [--yes]",
	"  /goal <objective> --replace [--start] [--tokens 100k]",
].join("\n");

interface GoalCustomComponent {
	render(width: number): string[];
	invalidate(): void;
	handleInput?(data: string): void;
}

interface GoalCustomOptions {
	overlay?: boolean;
	overlayOptions?: Record<string, unknown>;
}

export interface GoalUiContext {
	ui?: {
		setStatus?: (key: string, value: string | undefined) => void;
		setWidget?: (key: string, value: string[] | undefined) => void;
		custom?: <T>(
			factory: (
				tui: { requestRender(): void },
				theme: unknown,
				keybindings: unknown,
				done: (result: T) => void,
			) => GoalCustomComponent,
			options?: GoalCustomOptions,
		) => Promise<T>;
	};
}

interface GoalOverlayTheme {
	fg?(color: string, text: string): string;
	bold?(text: string): string;
}

export interface GoalDoctorRuntimeSnapshot {
	isIdle?: boolean;
	hasPendingMessages?: boolean;
	now?: number;
}

export function applyGoalUi(ctx: GoalUiContext, goal: GoalState | null): void {
	ctx.ui?.setStatus?.("goal", undefined);
	ctx.ui?.setWidget?.(
		"goal",
		goal && !goal.dismissedAt
			? renderGoalWidget(goal, goalWidgetExpanded)
			: undefined,
	);
}

export function isGoalWidgetExpanded(): boolean {
	return goalWidgetExpanded;
}

export function setGoalWidgetExpanded(expanded: boolean): boolean {
	const next = Boolean(expanded);
	const changed = goalWidgetExpanded !== next;
	goalWidgetExpanded = next;
	return changed;
}

export function toggleGoalWidgetExpanded(): boolean {
	goalWidgetExpanded = !goalWidgetExpanded;
	return goalWidgetExpanded;
}

export async function showGoalOverlay(
	ctx: GoalUiContext,
	goal: GoalState,
): Promise<void> {
	if (!ctx.ui?.custom) return;

	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			let expanded = false;
			let cachedWidth: number | undefined;
			let cachedLines: string[] | undefined;

			const invalidate = () => {
				cachedWidth = undefined;
				cachedLines = undefined;
			};

			return {
				render(width) {
					if (cachedLines && cachedWidth === width) return cachedLines;
					cachedWidth = width;
					cachedLines = renderGoalOverlayLines(
						goal,
						expanded,
						width,
						toOverlayTheme(theme),
					);
					return cachedLines;
				},
				invalidate,
				handleInput(data) {
					if (isEscape(data)) {
						done();
						return;
					}
					if (isEnter(data) || isSpace(data)) {
						expanded = !expanded;
						invalidate();
						tui.requestRender();
					}
				},
			};
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "right-center",
				width: "46%",
				minWidth: 48,
				maxWidth: 88,
				margin: 1,
			},
		},
	);
}

export function renderGoalSummary(goal: GoalState): string {
	const elapsed = formatElapsedTime(goal.runStartedAt);
	const lines = [
		`Goal: ${goal.objective}`,
		`Status: ${goal.status}`,
		`Running: ${elapsed}`,
		`Evaluator turns: ${goal.evaluationTurns}`,
		`Token spend: ${formatTokenSpend(goal)}`,
		`Last evaluator reason: ${goal.lastEvaluationReason}`,
		`Progress: ${goal.progress.summary || "No progress recorded yet."}`,
	];
	const continuation = renderContinuationStatus(goal);
	if (continuation) lines.push(`Continuation: ${continuation}`);
	if (goal.progress.current) lines.push(`Current: ${goal.progress.current}`);
	if (goal.progress.blocked.length > 0)
		lines.push(`Blocked: ${goal.progress.blocked.join("; ")}`);
	if (goal.acceptanceCriteria.length > 0)
		lines.push(
			`Acceptance criteria: ${goal.acceptanceCriteria.length} item(s)`,
		);
	if (goal.pauseReason)
		lines.push(
			`Pause reason: ${goal.pauseReason}${goal.pauseMessage ? ` — ${goal.pauseMessage}` : ""}`,
		);
	return lines.join("\n");
}

export function renderGoalStatusLine(goal: GoalState): string {
	let prefix = "/goal complete";
	if (goal.status === "active") {
		prefix = "/goal active";
	} else if (goal.status === "paused") {
		prefix = "/goal paused";
	}
	const detail =
		renderContinuationStatus(goal) ||
		goal.progress.current ||
		goal.progress.summary;
	return detail ? `${prefix} · ${truncate(detail, 56)}` : prefix;
}

// ast-grep-ignore no-flag-argument -- public renderer API keeps backward-compatible expanded option.
export function renderGoalWidget(goal: GoalState, expanded = false): string[] {
	const lines = [
		`Goal (${goal.status})${expanded ? " · expanded" : ""}`,
		truncate(goal.objective, 72),
		`Turns ${goal.evaluationTurns} · Time ${formatElapsedTime(goal.runStartedAt)} · Tokens ${formatTokenSpend(goal)}`,
	];
	const continuation = renderContinuationStatus(goal);
	if (continuation) lines.push(`Continuation: ${truncate(continuation, 72)}`);
	if (goal.progress.current) {
		lines.push(`Now: ${truncate(goal.progress.current, 72)}`);
	} else if (goal.progress.summary) {
		lines.push(`Progress: ${truncate(goal.progress.summary, 72)}`);
	}
	if (!expanded) {
		if (goal.progress.blocked.length > 0)
			lines.push(`Blocked: ${truncate(goal.progress.blocked.join("; "), 72)}`);
		if (goal.pauseReason)
			lines.push(
				`Paused: ${truncate(goal.pauseMessage || goal.pauseReason, 72)}`,
			);
		return styleGoalWidgetLines(lines);
	}
	if (
		goal.progress.summary &&
		goal.progress.summary !== goal.progress.current
	) {
		lines.push(`Summary: ${truncate(goal.progress.summary, 72)}`);
	}
	if (goal.progress.done.length > 0)
		lines.push(`Done: ${truncate(summarizeList(goal.progress.done), 72)}`);
	if (goal.progress.blocked.length > 0)
		lines.push(
			`Blocked: ${truncate(summarizeList(goal.progress.blocked), 72)}`,
		);
	if (goal.acceptanceCriteria.length > 0) {
		lines.push(
			`Criteria: ${truncate(summarizeList(goal.acceptanceCriteria), 72)}`,
		);
	}
	if (goal.sourcePaths.length > 0)
		lines.push(`Paths: ${truncate(summarizeList(goal.sourcePaths), 72)}`);
	return styleGoalWidgetLines(lines);
}

export function renderGoalOverlayLines(
	goal: GoalState,
	expanded: boolean,
	width: number,
	theme?: GoalOverlayTheme,
): string[] {
	const outerWidth = Math.max(4, width);
	const innerWidth = Math.max(1, outerWidth - 2);
	const lines: string[] = [];
	const fg = (color: string, text: string) =>
		safeThemeCall(theme ?? {}, theme?.fg, [color, text], text);
	const bold = (text: string) =>
		safeThemeCall(theme ?? {}, theme?.bold, [text], text);

	const row = (content = "") => {
		const clipped = truncateToVisibleWidth(content, innerWidth);
		lines.push(
			`${fg("border", "│")}${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))}${fg("border", "│")}`,
		);
	};

	const addWrappedRow = (prefix: string, text: string, color: string) => {
		const prefixWidth = visibleWidth(prefix);
		const available = Math.max(1, innerWidth - prefixWidth);
		const wrapped = wrapPlainText(text, available);
		const chunks = wrapped.length > 0 ? wrapped : [""];
		for (let i = 0; i < chunks.length; i++) {
			row(
				`${i === 0 ? prefix : " ".repeat(prefixWidth)}${fg(color, chunks[i])}`,
			);
		}
	};

	const elapsed = formatElapsedTime(goal.runStartedAt);
	let headline = `Reason: ${goal.lastEvaluationReason}`;
	if (goal.progress.current) {
		headline = `Now: ${goal.progress.current}`;
	} else if (goal.progress.summary) {
		headline = `Progress: ${goal.progress.summary}`;
	}

	lines.push(fg("border", `╭${"─".repeat(innerWidth)}╮`));
	row(` ${fg("accent", bold(`Goal · ${goal.status}`))}`);
	row("");
	addWrappedRow(" ", goal.objective, "text");
	row("");
	addWrappedRow(
		" ",
		`Turns ${goal.evaluationTurns} · Time ${elapsed} · Tokens ${formatTokenSpend(goal)}`,
		"muted",
	);
	const continuation = renderContinuationStatus(goal);
	if (continuation)
		addWrappedRow(" ", `Continuation: ${continuation}`, "warning");
	addWrappedRow(" ", headline, "text");

	if (expanded) {
		row("");
		addWrappedRow(" ", `Running: ${elapsed}`, "muted");
		addWrappedRow(" ", `Last evaluator: ${goal.lastEvaluationReason}`, "muted");
		if (continuation)
			addWrappedRow(" ", `Continuation: ${continuation}`, "warning");
		if (goal.pauseReason)
			addWrappedRow(
				" ",
				`Pause reason: ${goal.pauseReason}${goal.pauseMessage ? ` — ${goal.pauseMessage}` : ""}`,
				"warning",
			);
		if (goal.progress.summary)
			addWrappedRow(" ", `Summary: ${goal.progress.summary}`, "text");
		if (goal.progress.current)
			addWrappedRow(" ", `Current: ${goal.progress.current}`, "text");
		if (goal.progress.done.length > 0)
			addWrappedRow(
				" ",
				`Done: ${summarizeList(goal.progress.done)}`,
				"success",
			);
		if (goal.progress.blocked.length > 0)
			addWrappedRow(
				" ",
				`Blocked: ${summarizeList(goal.progress.blocked)}`,
				"warning",
			);
		if (goal.acceptanceCriteria.length > 0) {
			addWrappedRow(
				" ",
				`Acceptance criteria: ${summarizeList(goal.acceptanceCriteria)}`,
				"muted",
			);
		}
		if (goal.sourcePaths.length > 0)
			addWrappedRow(" ", `Paths: ${summarizeList(goal.sourcePaths)}`, "muted");
	}

	row("");
	addWrappedRow(
		" ",
		expanded
			? "Enter/Space collapse • Esc close"
			: "Enter/Space expand • Esc close",
		"dim",
	);
	lines.push(fg("border", `╰${"─".repeat(innerWidth)}╯`));
	return lines;
}

export function renderGoalDoctor(
	goal: GoalState,
	runtime: GoalDoctorRuntimeSnapshot = {},
): string {
	const now = runtime.now ?? Date.now();
	const continuation = renderContinuationStatus(goal, now);
	const idle = formatProbe(runtime.isIdle);
	const hasPendingMessages = formatProbe(runtime.hasPendingMessages);
	const lines = [
		"Goal doctor",
		`Status: ${goal.status}`,
		`Objective: ${goal.objective}`,
		`Runtime idle: ${idle}`,
		`Runtime pending messages: ${hasPendingMessages}`,
		`Continuation phase: ${goal.continuationPhase ?? "none"}`,
		`Continuation attempt: ${goal.continuationAttempt ?? 0}/${MAX_CONTINUATION_DELIVERY_ATTEMPTS}`,
		`Continuation failures: ${goal.continuationFailures ?? 0}`,
		`Continuation mode: ${goal.continuationLastMode ?? "none"}`,
		`Continuation pending: ${continuation ?? "none"}`,
		goal.continuationLastError
			? `Last continuation error: ${goal.continuationLastError}`
			: undefined,
		`Recommendation: ${renderGoalDoctorRecommendation(goal, runtime, now)}`,
	];
	return lines.filter((line): line is string => Boolean(line)).join("\n");
}

export function renderContinuationStatus(
	goal: GoalState,
	now = Date.now(),
): string | undefined {
	if (typeof goal.continuationPendingAt !== "number") return undefined;
	const age = formatElapsedTime(goal.continuationPendingAt, now);
	const phase = goal.continuationPhase ?? "pending";
	const attempt = goal.continuationAttempt ?? 0;
	const retryIn = Math.max(
		0,
		getContinuationRetryDelayMs(goal) - (now - goal.continuationPendingAt),
	);
	const parts = [
		`${phase} for ${age}`,
		attempt > 0
			? `attempt ${attempt}/${MAX_CONTINUATION_DELIVERY_ATTEMPTS}`
			: undefined,
		goal.continuationLastMode ? `mode ${goal.continuationLastMode}` : undefined,
		renderContinuationRetryState(goal, now, retryIn),
	];
	return parts.filter(Boolean).join(" · ");
}

function renderContinuationRetryState(
	goal: GoalState,
	now: number,
	retryIn: number,
): string {
	if (!hasStalePendingContinuation(goal, now)) {
		return `next retry in ${formatElapsedTime(now, now + retryIn)}`;
	}
	return hasReachedContinuationDeliveryLimit(goal)
		? "delivery limit reached"
		: "stale; retry eligible";
}

function renderGoalDoctorRecommendation(
	goal: GoalState,
	runtime: GoalDoctorRuntimeSnapshot,
	now: number,
): string {
	if (goal.status === "complete")
		return "Goal is complete; no continuation needed.";
	if (goal.status === "paused")
		return "Goal is paused; inspect pause reason or run /goal resume.";
	if (runtime.hasPendingMessages === true)
		return "Pi already has pending messages; avoid injecting a duplicate continuation.";
	if (runtime.isIdle === false)
		return "Pi is not idle; continuation should be delivered as follow-up.";
	if (typeof goal.continuationPendingAt !== "number")
		return "No continuation is pending; /goal start can kick off a new turn.";
	if (
		hasReachedContinuationDeliveryLimit(goal) &&
		hasStalePendingContinuation(goal, now)
	)
		return "Continuation delivery limit reached; runtime should pause instead of staying active.";
	if (hasStalePendingContinuation(goal, now))
		return "Continuation is stale; watchdog should retry now.";
	return "Continuation is pending; wait for the watchdog window before retrying.";
}

function formatProbe(value: boolean | undefined): string {
	return value === undefined ? "unknown" : String(value);
}

function toOverlayTheme(value: unknown): GoalOverlayTheme | undefined {
	if (!value || typeof value !== "object") return undefined;
	const source = value as { fg?: unknown; bold?: unknown };
	return {
		fg:
			typeof source.fg === "function"
				? (color, text) => safeThemeCall(source, source.fg, [color, text], text)
				: undefined,
		bold:
			typeof source.bold === "function"
				? (text) => safeThemeCall(source, source.bold, [text], text)
				: undefined,
	};
}

function safeThemeCall<T>(
	source: object,
	fn: unknown,
	args: unknown[],
	fallback: T,
): T {
	if (typeof fn !== "function") return fallback;
	try {
		const result = fn.apply(source, args) as T;
		return typeof result === "string" ? result : fallback;
	} catch {
		return fallback;
	}
}

function styleGoalWidgetLines(lines: string[]): string[] {
	return lines.map((line, index) => {
		const fg = index === 0 ? GOAL_WIDGET_ACCENT : GOAL_WIDGET_FG;
		return `${GOAL_WIDGET_BG}${fg} ${line} ${ANSI_RESET}`;
	});
}

function isEscape(data: string): boolean {
	return data === "\u001b" || data === "\u001b\u001b";
}

function isEnter(data: string): boolean {
	return data === "\r" || data === "\n";
}

function isSpace(data: string): boolean {
	return data === " ";
}

export function noGoalMessage(action: string): string {
	return `No goal exists to ${action}. Start one with /goal <objective>.`;
}

export function nonInteractiveConfirmationMessage(command: string): string {
	return `${command} requires confirmation in non-interactive mode. Re-run with --yes or --replace.`;
}
