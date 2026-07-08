import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalSessionEntry } from "../src/goal-state-persistence.js";
import goalExtension, {
	GOAL_CONTEXT_CUSTOM_TYPE,
	loadGoalState,
} from "../src/index.js";

const evaluatorDecisions = vi.hoisted(() => ({
	responses: [] as string[],
}));

vi.mock("@earendil-works/pi-ai/compat", () => ({
	complete: vi.fn(async () => ({
		content: [
			{
				type: "text",
				text:
					evaluatorDecisions.responses.shift() ??
					'{"met":false,"reason":"keep going"}',
			},
		],
	})),
}));

type RegisteredCommand = {
	description: string;
	handler: (args: string, ctx: unknown) => Promise<void>;
};
type HookHandler = (event: unknown, ctx: unknown) => unknown;

describe("goal extension E2E smoke", () => {
	beforeEach(() => {
		evaluatorDecisions.responses = [];
	});

	it("auto-continues an active /goal until the evaluator marks it complete", async () => {
		evaluatorDecisions.responses = [
			'{"met":false,"reason":"needs one more turn"}',
			'{"met":true,"reason":"done"}',
		];
		const harness = createHarness();

		goalExtension(harness.pi);

		await harness.commands
			.get("goal")
			?.handler("ship the in-process smoke test", harness.ctx);

		const created = loadGoalState(harness.ctx);
		expect(created?.objective).toBe("ship the in-process smoke test");
		expect(created?.status).toBe("active");
		const goalId = created?.goalId;
		expect(goalId).toBeTruthy();
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.prompt).toContain(
			"ship the in-process smoke test",
		);

		const beforeAgentStart = await harness.fire("before_agent_start", {});

		expect(beforeAgentStart).toEqual(
			expect.objectContaining({
				message: expect.objectContaining({
					customType: GOAL_CONTEXT_CUSTOM_TYPE,
					content: expect.stringContaining("ship the in-process smoke test"),
					details: expect.objectContaining({
						goalId,
					}),
				}),
			}),
		);

		await harness.fire("agent_end", { messages: [] });

		expect(loadGoalState(harness.ctx)?.status).toBe("active");
		expect(harness.sentMessages).toHaveLength(2);
		expect(harness.sentMessages[1]?.prompt).toContain("needs one more turn");
		expect(harness.sentMessages[1]?.prompt).toContain(`goal_id: ${goalId}`);
		expect(harness.sentMessages[1]?.prompt).toContain(
			"ship the in-process smoke test",
		);

		await harness.fire("agent_end", { messages: [] });

		const completed = loadGoalState(harness.ctx);
		expect(completed?.status).toBe("complete");
		expect(completed?.lastEvaluationReason).toBe("done");
		expect(harness.sentMessages).toHaveLength(2);
	});
});

function createHarness() {
	const branch: GoalSessionEntry[] = [];
	const commands = new Map<string, RegisteredCommand>();
	const handlers = new Map<string, HookHandler>();
	const sentMessages: Array<{
		prompt: string;
		options?: { deliverAs: "followUp" };
	}> = [];
	const notifications: Array<{
		message: string;
		level?: "info" | "warning" | "error";
	}> = [];
	const widgets: Record<string, string[] | undefined> = {};
	const statuses: Record<string, string | undefined> = {};
	const ctx = {
		hasUI: false,
		isIdle: vi.fn(() => true),
		hasPendingMessages: vi.fn(() => false),
		waitForIdle: vi.fn(async () => {}),
		// Mirror the real Pi 0.80.3 extension context: the host exposes
		// sessionManager.{sessionId, leafId} and does NOT provide a goalProtocol
		// field. The extension must derive its protocol context from these.
		sessionManager: {
			getBranch: vi.fn(() => branch),
			sessionId: "test-session",
			leafId: "test-leaf",
		},
		model: { provider: "anthropic", id: "custom" },
		modelRegistry: {
			find: vi.fn((_provider: string, id: string) => ({ id })),
			getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "key" })),
		},
		ui: {
			notify(message: string, level?: "info" | "warning" | "error") {
				notifications.push({ message, level });
			},
			confirm: vi.fn(async () => true),
			editor: vi.fn(async () => undefined),
			setStatus(key: string, value: string | undefined) {
				statuses[key] = value;
			},
			setWidget(key: string, value: string[] | undefined) {
				widgets[key] = value;
			},
		},
	};
	const pi = {
		registerCommand(name: string, command: RegisteredCommand) {
			commands.set(name, command);
		},
		registerTool() {},
		on(hook: string, handler: HookHandler) {
			handlers.set(hook, handler);
		},
		appendEntry(customType: string, data?: unknown) {
			branch.push({ type: "custom", customType, data });
		},
		sendUserMessage(prompt: string, options?: { deliverAs: "followUp" }) {
			sentMessages.push({ prompt, options });
		},
	};
	return {
		branch,
		commands,
		ctx,
		notifications,
		pi: pi as unknown as Parameters<typeof goalExtension>[0],
		sentMessages,
		statuses,
		widgets,
		async fire(hook: string, event: unknown) {
			const handler = handlers.get(hook);
			if (!handler) throw new Error(`Missing hook: ${hook}`);
			return handler(event, ctx);
		},
	};
}
