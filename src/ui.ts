import type { GoalState } from "./types.js";

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

export interface GoalUiContext {
  ui?: {
    setStatus?: (key: string, value: string | undefined) => void;
    setWidget?: (key: string, value: string[] | undefined) => void;
  };
}

export function applyGoalUi(ctx: GoalUiContext, goal: GoalState | null): void {
  ctx.ui?.setStatus?.("goal", goal ? renderGoalStatusLine(goal) : undefined);
  ctx.ui?.setWidget?.("goal", goal ? renderGoalWidget(goal) : undefined);
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
  if (goal.acceptanceCriteria.length > 0)
    lines.push(`Acceptance criteria: ${goal.acceptanceCriteria.length} item(s)`);
  return lines.join("\n");
}

export function renderGoalStatusLine(goal: GoalState): string {
  const prefix = goal.status === "active" ? "/goal active" : goal.status === "paused" ? "/goal paused" : "/goal complete";
  return `${prefix}: ${goal.objective}`;
}

export function renderGoalWidget(goal: GoalState): string[] {
  const lines = [
    `Goal (${goal.status})`,
    goal.objective,
    `Eval turns: ${goal.evaluationTurns}  Tokens: ${goal.usage.total}`,
    `Reason: ${goal.lastEvaluationReason}`,
    `Progress: ${goal.progress.summary || "No progress recorded yet."}`,
  ];
  if (goal.progress.current) lines.push(`Now: ${goal.progress.current}`);
  if (goal.progress.blocked.length > 0) lines.push(`Blocked: ${goal.progress.blocked.join("; ")}`);
  return lines;
}

export function noGoalMessage(action: string): string {
  return `No goal exists to ${action}. Start one with /goal <objective>.`;
}

export function nonInteractiveConfirmationMessage(command: string): string {
  return `${command} requires confirmation in non-interactive mode. Re-run with --yes or --replace.`;
}
