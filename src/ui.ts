import type { GoalState } from "./types.js";

let goalWidgetExpanded = false;

export const GOAL_USAGE = [
  "Usage:",
  "  /goal <objective>",
  "  /goal status",
  "  /goal edit",
  "  /goal pause|resume [--start]",
  "  /goal start",
  "  /goal clear [--yes]",
  "  /goal complete [--yes]",
  "  /goal <objective> --replace [--start]",
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

export function applyGoalUi(ctx: GoalUiContext, goal: GoalState | null): void {
  ctx.ui?.setStatus?.("goal", goal ? renderGoalStatusLine(goal) : undefined);
  ctx.ui?.setWidget?.("goal", goal && goal.status !== "complete" ? renderGoalWidget(goal, goalWidgetExpanded) : undefined);
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

export async function showGoalOverlay(ctx: GoalUiContext, goal: GoalState): Promise<void> {
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
          cachedLines = renderGoalOverlayLines(goal, expanded, width, toOverlayTheme(theme));
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
  const minutes = Math.max(0, Math.floor((Date.now() - goal.runStartedAt) / 60000));
  const lines = [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Running: ${minutes} minute(s)`,
    `Evaluator turns: ${goal.evaluationTurns}`,
    `Token spend: ${goal.usage.total}`,
    `Last evaluator reason: ${goal.lastEvaluationReason}`,
    `Progress: ${goal.progress.summary || "No progress recorded yet."}`,
  ];
  if (goal.progress.current) lines.push(`Current: ${goal.progress.current}`);
  if (goal.progress.blocked.length > 0) lines.push(`Blocked: ${goal.progress.blocked.join("; ")}`);
  if (goal.acceptanceCriteria.length > 0) lines.push(`Acceptance criteria: ${goal.acceptanceCriteria.length} item(s)`);
  return lines.join("\n");
}

export function renderGoalStatusLine(goal: GoalState): string {
  const prefix = goal.status === "active" ? "/goal active" : goal.status === "paused" ? "/goal paused" : "/goal complete";
  return `${prefix}: ${goal.objective}`;
}

export function renderGoalWidget(goal: GoalState, expanded = false): string[] {
  const lines = [
    `Goal (${goal.status})${expanded ? " · expanded" : ""}`,
    truncate(goal.objective, 72),
    `Turns ${goal.evaluationTurns} · Tokens ${formatCompactNumber(goal.usage.total)}`,
  ];
  if (goal.progress.current) {
    lines.push(`Now: ${truncate(goal.progress.current, 72)}`);
  } else if (goal.progress.summary) {
    lines.push(`Progress: ${truncate(goal.progress.summary, 72)}`);
  }
  if (!expanded) {
    if (goal.progress.blocked.length > 0) lines.push(`Blocked: ${truncate(goal.progress.blocked.join("; "), 72)}`);
    return lines;
  }
  if (goal.progress.summary && goal.progress.summary !== goal.progress.current) {
    lines.push(`Summary: ${truncate(goal.progress.summary, 72)}`);
  }
  if (goal.progress.done.length > 0) lines.push(`Done: ${truncate(summarizeList(goal.progress.done), 72)}`);
  if (goal.progress.blocked.length > 0) lines.push(`Blocked: ${truncate(summarizeList(goal.progress.blocked), 72)}`);
  if (goal.acceptanceCriteria.length > 0) {
    lines.push(`Criteria: ${truncate(summarizeList(goal.acceptanceCriteria), 72)}`);
  }
  if (goal.sourcePaths.length > 0) lines.push(`Paths: ${truncate(summarizeList(goal.sourcePaths), 72)}`);
  return lines;
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
  const fg = (color: string, text: string) => theme?.fg?.(color, text) ?? text;
  const bold = (text: string) => theme?.bold?.(text) ?? text;

  const row = (content = "") => {
    const clipped = truncateToVisibleWidth(content, innerWidth);
    lines.push(`${fg("border", "│")}${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))}${fg("border", "│")}`);
  };

  const addWrappedRow = (prefix: string, text: string, color: string) => {
    const prefixWidth = visibleWidth(prefix);
    const available = Math.max(1, innerWidth - prefixWidth);
    const wrapped = wrapPlainText(text, available);
    const chunks = wrapped.length > 0 ? wrapped : [""];
    for (let i = 0; i < chunks.length; i++) {
      row(`${i === 0 ? prefix : " ".repeat(prefixWidth)}${fg(color, chunks[i])}`);
    }
  };

  const minutes = Math.max(0, Math.floor((Date.now() - goal.runStartedAt) / 60000));
  const headline = goal.progress.current
    ? `Now: ${goal.progress.current}`
    : goal.progress.summary
      ? `Progress: ${goal.progress.summary}`
      : `Reason: ${goal.lastEvaluationReason}`;

  lines.push(fg("border", `╭${"─".repeat(innerWidth)}╮`));
  row(` ${fg("accent", bold(`Goal · ${goal.status}`))}`);
  row("");
  addWrappedRow(" ", goal.objective, "text");
  row("");
  addWrappedRow(" ", `Turns ${goal.evaluationTurns} · Tokens ${formatCompactNumber(goal.usage.total)}`, "muted");
  addWrappedRow(" ", headline, "text");

  if (expanded) {
    row("");
    addWrappedRow(" ", `Running: ${minutes} minute(s)`, "muted");
    addWrappedRow(" ", `Last evaluator: ${goal.lastEvaluationReason}`, "muted");
    if (goal.progress.summary) addWrappedRow(" ", `Summary: ${goal.progress.summary}`, "text");
    if (goal.progress.current) addWrappedRow(" ", `Current: ${goal.progress.current}`, "text");
    if (goal.progress.done.length > 0) addWrappedRow(" ", `Done: ${summarizeList(goal.progress.done)}`, "success");
    if (goal.progress.blocked.length > 0) addWrappedRow(" ", `Blocked: ${summarizeList(goal.progress.blocked)}`, "warning");
    if (goal.acceptanceCriteria.length > 0) {
      addWrappedRow(" ", `Acceptance criteria: ${summarizeList(goal.acceptanceCriteria)}`, "muted");
    }
    if (goal.sourcePaths.length > 0) addWrappedRow(" ", `Paths: ${summarizeList(goal.sourcePaths)}`, "muted");
  }

  row("");
  addWrappedRow(" ", expanded ? "Enter/Space collapse • Esc close" : "Enter/Space expand • Esc close", "dim");
  lines.push(fg("border", `╰${"─".repeat(innerWidth)}╯`));
  return lines;
}

function toOverlayTheme(value: unknown): GoalOverlayTheme | undefined {
  if (!value || typeof value !== "object") return undefined;
  const fg = (value as { fg?: unknown }).fg;
  const bold = (value as { bold?: unknown }).bold;
  return {
    fg: typeof fg === "function" ? (color, text) => (fg as (color: string, text: string) => string)(color, text) : undefined,
    bold: typeof bold === "function" ? (text) => (bold as (text: string) => string)(text) : undefined,
  };
}

function visibleWidth(value: string): number {
  return stripAnsi(value).length;
}

function truncateToVisibleWidth(value: string, width: number): string {
  const plain = stripAnsi(value);
  return plain.length <= width ? value : plain.slice(0, Math.max(0, width));
}

function wrapPlainText(value: string, width: number): string[] {
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
    current = chunks[chunks.length - 1] ?? "";
  }

  if (current) lines.push(current);
  return lines;
}

function chunkText(value: string, width: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += width) chunks.push(value.slice(i, i + width));
  return chunks;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, "");
}

function summarizeList(values: string[]): string {
  if (values.length <= 2) return values.join("; ");
  return `${values[0]}; ${values[1]}; +${values.length - 2} more`;
}

function truncate(value: string, max = 72): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
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
