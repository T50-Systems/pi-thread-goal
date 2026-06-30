import { complete, type Message } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  GOAL_CONTEXT_CUSTOM_TYPE,
  renderGoalCompactionSummary,
  renderGoalContext,
  renderGoalContinuationPrompt,
  renderGoalEvaluationPrompt,
} from "./prompts.js";
import { loadGoalState, saveGoalState } from "./state.js";
import { applyGoalUi } from "./ui.js";
import type { GoalState, GoalUsage } from "./types.js";

interface GoalRuntimeContext {
  sessionManager: { getBranch(): Array<{ type: string; customType?: string; data?: unknown }> };
  model?: { provider: string; id: string };
  modelRegistry: {
    find(provider: string, id: string): unknown;
    getApiKeyAndHeaders(model: unknown): Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string }>;
  };
  signal?: AbortSignal;
  isIdle?: () => boolean;
  hasPendingMessages?: () => boolean;
  ui?: {
    notify?: (message: string, level?: "info" | "warning" | "error") => void;
    setStatus?: (key: string, value: string | undefined) => void;
    setWidget?: (key: string, value: string[] | undefined) => void;
  };
}

interface ContextMessage {
  customType?: string;
  content?: unknown;
  details?: unknown;
}

interface EvaluatorDecision {
  met: boolean;
  reason: string;
}

const EVALUATOR_SYSTEM_PROMPT =
  "You evaluate whether a goal condition is already satisfied. Read the goal condition and the conversation evidence. Return strict JSON only: {\"met\": boolean, \"reason\": string}. The reason must be one concise sentence.";

export function registerGoalRuntime(pi: ExtensionAPI): void {
  let evaluatingGoalId: string | null = null;

  pi.on("before_agent_start", async (_event, ctx) => {
    const goal = loadGoalState(ctx as GoalRuntimeContext);
    if (!isActiveGoal(goal)) return;
    return {
      message: {
        customType: GOAL_CONTEXT_CUSTOM_TYPE,
        content: renderGoalContext(goal),
        display: false,
        details: { goalId: goal.goalId },
      },
    };
  });

  pi.on("context", async (event, ctx) => {
    const goal = loadGoalState(ctx as GoalRuntimeContext);
    return {
      messages: filterGoalContextMessages(event.messages as ContextMessage[], goal) as typeof event.messages,
    };
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const goal = loadGoalState(ctx as GoalRuntimeContext);
    if (!isActiveGoal(goal)) return;
    const previous = event.preparation.previousSummary?.trim();
    const summary = [previous || "Conversation summary preserved by Pi.", renderGoalCompactionSummary(goal)]
      .filter(Boolean)
      .join("\n\n");

    return {
      compaction: {
        summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        details: { goalId: goal.goalId },
      },
    };
  });

  pi.on("session_start", async (event, ctx) => {
    const goal = loadGoalState(ctx as GoalRuntimeContext);
    applyGoalUi(ctx as GoalRuntimeContext, goal);
    if (event.reason === "resume" && isActiveGoal(goal) && ctx.isIdle?.() === true) {
      const prompt = renderGoalContinuationPrompt(goal, "Resumed with an active goal. Continue working toward it.");
      pi.sendUserMessage(prompt);
      ctx.ui?.notify?.("Resumed active goal.", "info");
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    applyGoalUi(ctx as GoalRuntimeContext, loadGoalState(ctx as GoalRuntimeContext));
  });

  pi.on("agent_end", async (event, ctx) => {
    const current = loadGoalState(ctx as GoalRuntimeContext);
    if (!isActiveGoal(current)) {
      applyGoalUi(ctx as GoalRuntimeContext, current);
      return;
    }
    if (evaluatingGoalId === current.goalId) {
      return;
    }

    evaluatingGoalId = current.goalId;
    try {
      const usage = collectUsage(event.messages as unknown[]);
      const latest = loadGoalState(ctx as GoalRuntimeContext);
      if (!isActiveGoal(latest)) return;

      const decision = await evaluateGoal(latest, ctx as GoalRuntimeContext);
      const reason = decision.reason.trim() || (decision.met ? "Goal condition satisfied." : "Goal condition not yet satisfied.");
      const evaluated = saveGoalState(
        pi,
        {
          action: "evaluation",
          goalId: latest.goalId,
          now: Date.now(),
          reason,
          usage,
        },
        latest,
      );
      applyGoalUi(ctx as GoalRuntimeContext, evaluated);

      if (decision.met) {
        const next = saveGoalState(
          pi,
          { action: "complete", goalId: latest.goalId, now: Date.now(), evidence: reason },
          evaluated,
        );
        applyGoalUi(ctx as GoalRuntimeContext, next);
        ctx.ui?.notify?.(`Goal complete: ${reason}`, "info");
        return;
      }

      const next = evaluated;
      applyGoalUi(ctx as GoalRuntimeContext, next);
      ctx.ui?.notify?.(`Goal continuing: ${reason}`, "info");

      const continuationPrompt = renderGoalContinuationPrompt(next ?? latest, reason);
      if (ctx.isIdle?.() === true && ctx.hasPendingMessages?.() !== true) {
        pi.sendUserMessage(continuationPrompt);
      } else {
        pi.sendUserMessage(continuationPrompt, { deliverAs: "followUp" });
      }
    } catch (error) {
      ctx.ui?.notify?.(
        `Goal evaluator failed: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    } finally {
      evaluatingGoalId = null;
    }
  });
}

export function filterGoalContextMessages<T extends ContextMessage>(messages: T[], goal: GoalState | null): T[] {
  const activeGoalId = isActiveGoal(goal) ? goal.goalId : undefined;
  let lastCurrentContextIndex = -1;

  if (activeGoalId) {
    messages.forEach((message, index) => {
      if (isGoalContextMessage(message) && messageHasGoalId(message, activeGoalId)) {
        lastCurrentContextIndex = index;
      }
    });
  }

  return messages.filter((message, index) => {
    if (!isGoalContextMessage(message)) return true;
    if (!activeGoalId) return false;
    return index === lastCurrentContextIndex && messageHasGoalId(message, activeGoalId);
  });
}

async function evaluateGoal(goal: GoalState, ctx: GoalRuntimeContext): Promise<EvaluatorDecision> {
  const model = pickEvaluatorModel(ctx);
  if (!model) {
    return { met: false, reason: "No evaluator model available; continue manually or configure a small fast model." };
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    return {
      met: false,
      reason: auth.ok ? "No evaluator API key available for the selected provider." : auth.error || "Evaluator auth failed.",
    };
  }

  const message: Message = {
    role: "user",
    content: [{ type: "text", text: renderGoalEvaluationPrompt(goal) }],
    timestamp: Date.now(),
  };

  const response = await complete(
    model as never,
    { systemPrompt: EVALUATOR_SYSTEM_PROMPT, messages: [message] },
    { apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal },
  );

  const text = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  return parseEvaluatorDecision(text);
}

function pickEvaluatorModel(ctx: GoalRuntimeContext): unknown {
  const provider = ctx.model?.provider;
  if (!provider) return ctx.model;

  const candidatesByProvider: Record<string, string[]> = {
    anthropic: ["claude-haiku-4-5", "claude-haiku-4", "claude-3-5-haiku-latest"],
    openai: ["gpt-5-nano", "gpt-5-mini", "gpt-4.1-mini"],
    "openai-codex": ["gpt-5-nano", "gpt-5-mini", "gpt-4.1-mini"],
    google: ["gemini-2.5-flash", "gemini-2.0-flash"],
  };

  for (const id of candidatesByProvider[provider] ?? []) {
    const found = ctx.modelRegistry.find(provider, id);
    if (found) return found;
  }

  return ctx.model;
}

function parseEvaluatorDecision(text: string): EvaluatorDecision {
  const match = text.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : text;
  try {
    const parsed = JSON.parse(candidate) as Partial<EvaluatorDecision>;
    return {
      met: Boolean(parsed.met),
      reason: typeof parsed.reason === "string" ? parsed.reason : "Evaluator returned no reason.",
    };
  } catch {
    return { met: false, reason: text || "Evaluator response was not valid JSON." };
  }
}

function collectUsage(messages: unknown[]): Partial<GoalUsage> {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const message of messages) {
    if (!isAssistantUsageMessage(message)) continue;
    usage.input += numericField(message.usage, "input");
    usage.output += numericField(message.usage, "output");
    usage.cacheRead += numericField(message.usage, "cacheRead");
    usage.cacheWrite += numericField(message.usage, "cacheWrite");
    usage.total +=
      numericField(message.usage, "total") ||
      numericField(message.usage, "totalTokens") ||
      numericField(message.usage, "input") + numericField(message.usage, "output");
  }
  return usage;
}

function isAssistantUsageMessage(
  value: unknown,
): value is { role: "assistant"; usage: Record<string, unknown> } {
  return typeof value === "object" && value !== null && (value as any).role === "assistant" && typeof (value as any).usage === "object";
}

function numericField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isActiveGoal(goal: GoalState | null): goal is GoalState {
  return goal !== null && goal.status === "active";
}

function isGoalContextMessage(message: ContextMessage): boolean {
  return message.customType === GOAL_CONTEXT_CUSTOM_TYPE;
}

function messageHasGoalId(message: ContextMessage, goalId: string): boolean {
  const details = message.details;
  return Boolean(
    typeof details === "object" && details !== null && "goalId" in details && (details as any).goalId === goalId,
  );
}
