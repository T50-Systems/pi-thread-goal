import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderGoalStartPrompt } from "./prompts.js";
import { loadGoalState, saveGoalState, validateObjective } from "./state.js";
import { GOAL_USAGE, applyGoalUi, noGoalMessage, nonInteractiveConfirmationMessage, renderGoalSummary } from "./ui.js";
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
  | "complete";

export interface ParsedGoalCommand {
  kind: GoalCommandKind;
  objective?: string;
  confirmed: boolean;
  replace: boolean;
  start: boolean;
}

interface GoalCommandContext {
  hasUI: boolean;
  isIdle(): boolean;
  waitForIdle(): Promise<void>;
  sessionManager: { getBranch(): Array<{ type: string; customType?: string; data?: unknown }> };
  ui: {
    notify(message: string, level?: "info" | "warning" | "error"): void;
    confirm(title: string, message: string): Promise<boolean>;
    editor(title: string, initialValue: string): Promise<string | undefined>;
    setStatus(key: string, value: string | undefined): void;
    setWidget(key: string, value: string[] | undefined): void;
  };
}

const CONTROL_COMMANDS = ["status", "edit", "pause", "resume", "start", "clear", "complete"];
const RECOGNIZED_FLAGS = new Set(["--yes", "-y", "--replace", "--start"]);

export function registerGoalCommand(pi: ExtensionAPI): void {
  pi.registerCommand("goal", {
    description: "Set or view the goal for a long-running task",
    getArgumentCompletions: (prefix) => {
      const items = CONTROL_COMMANDS.filter((command) => command.startsWith(prefix));
      return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => handleGoalCommand(pi, args, ctx as GoalCommandContext),
  });
}

export function parseGoalCommand(args: string): ParsedGoalCommand {
  const trimmed = args.trim();
  if (!trimmed) return { kind: "show", confirmed: false, replace: false, start: false };

  const tokens = trimmed.split(/\s+/);
  const first = tokens[0] ?? "";
  const confirmed = tokens.includes("--yes") || tokens.includes("-y");
  const replace = tokens.includes("--replace");
  const start = tokens.includes("--start");

  if (first === "status") return { kind: "status", confirmed, replace, start };
  if (first === "edit") return { kind: "edit", confirmed, replace, start };
  if (first === "pause") return { kind: "pause", confirmed, replace, start };
  if (first === "resume") return { kind: "resume", confirmed, replace, start };
  if (first === "start") return { kind: "start", confirmed, replace, start: true };
  if (first === "clear") return { kind: "clear", confirmed, replace, start };
  if (first === "complete") return { kind: "complete", confirmed, replace, start };

  if (["clear", "stop", "off", "reset", "none", "cancel"].includes(first)) {
    return { kind: "clear", confirmed, replace, start };
  }

  const objective = tokens.filter((token) => !RECOGNIZED_FLAGS.has(token)).join(" ").trim();
  return { kind: "create", objective, confirmed, replace, start };
}

export async function handleGoalCommand(
  pi: ExtensionAPI,
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
    ctx.ui.notify(renderGoalSummary(current), "info");
    applyGoalUi(ctx, current);
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
      const next = saveGoalState(pi, { action: "pause", goalId: current.goalId, now: Date.now() }, current);
      applyGoalUi(ctx, next);
      ctx.ui.notify("Goal paused.", "info");
      return;
    }
    case "resume": {
      if (!current) {
        ctx.ui.notify(noGoalMessage("resume"), "error");
        return;
      }
      const next = saveGoalState(pi, { action: "resume", goalId: current.goalId, now: Date.now() }, current);
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
      const ok = await confirmAction(ctx, parsed.confirmed, "Clear goal?", "/goal clear");
      if (!ok) return;
      const next = saveGoalState(pi, { action: "clear", goalId: current.goalId, now: Date.now() }, current);
      applyGoalUi(ctx, next);
      ctx.ui.notify("Goal cleared.", "info");
      return;
    }
    case "complete": {
      if (!current) {
        ctx.ui.notify(noGoalMessage("complete"), "warning");
        return;
      }
      const ok = await confirmAction(ctx, parsed.confirmed, "Mark goal complete?", "/goal complete");
      if (!ok) return;
      const next = saveGoalState(pi, { action: "complete", goalId: current.goalId, now: Date.now() }, current);
      applyGoalUi(ctx, next);
      ctx.ui.notify("Goal marked complete.", "info");
      return;
    }
    default:
      return;
  }
}

async function createOrReplaceGoal(
  pi: ExtensionAPI,
  ctx: GoalCommandContext,
  parsed: ParsedGoalCommand,
  current: GoalState | null,
): Promise<void> {
  const objective = validateObjective(parsed.objective ?? "");

  if (current && !parsed.replace) {
    if (!ctx.hasUI) {
      ctx.ui.notify(nonInteractiveConfirmationMessage("/goal <objective>"), "error");
      return;
    }
    const ok = await ctx.ui.confirm("Replace current goal?", current.objective + "\n\nNew goal:\n" + objective);
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
        now: Date.now(),
      }
    : {
        action: "create" as const,
        goalId: randomUUID(),
        objective,
        now: Date.now(),
      };

  const next = saveGoalState(pi, event, current);
  applyGoalUi(ctx, next);
  ctx.ui.notify(current ? "Goal replaced." : "Goal created.", "info");
  if (next) {
    startGoal(pi, ctx, next);
  }
}

async function editGoal(pi: ExtensionAPI, ctx: GoalCommandContext, current: GoalState | null): Promise<void> {
  if (!current) {
    ctx.ui.notify(noGoalMessage("edit"), "error");
    return;
  }
  if (!ctx.hasUI) {
    ctx.ui.notify("/goal edit requires interactive UI. Use /goal <objective> --replace instead.", "error");
    return;
  }

  const edited = await ctx.ui.editor("Edit goal", current.objective);
  if (edited === undefined) {
    ctx.ui.notify("Goal edit cancelled.", "info");
    return;
  }

  const next = saveGoalState(
    pi,
    { action: "edit", goalId: current.goalId, objective: validateObjective(edited), now: Date.now() },
    current,
  );
  applyGoalUi(ctx, next);
  ctx.ui.notify("Goal updated.", "info");
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

export function startGoal(pi: ExtensionAPI, ctx: Pick<GoalCommandContext, "isIdle" | "ui">, goal: GoalState): void {
  const prompt = renderGoalStartPrompt(goal);
  if (ctx.isIdle()) {
    pi.sendUserMessage(prompt);
  } else {
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  }
  ctx.ui.notify("Goal turn started.", "info");
}
