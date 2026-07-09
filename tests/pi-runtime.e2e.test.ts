import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import goalExtension, {
	GOAL_CUSTOM_TYPE,
	loadGoalState,
} from "../src/index.js";

// Layer 1 verification: drive the extension against Pi's REAL SessionManager
// instead of a hand-built fake. This is the harness that would have caught
// both shipped bugs:
//   1. The extension read a `goalProtocol` field that real Pi never sets. A
//      fake ctx that supplied it hid the bind failure.
//   2. branchId was derived from the session leaf, which the real
//      SessionManager advances on every appended entry, breaking the
//      get_goal -> prepare_goal_completion handshake. A fake with a fixed
//      leafId hid it.
// Using the real SessionManager, ctx.sessionManager.{sessionId, leafId,
// getBranch} behave exactly as they do in a live Pi session, and appended
// goal entries advance the real leaf.

interface RegisteredCommand {
	handler: (args: string, ctx: unknown) => Promise<void>;
}
interface RegisteredTool {
	name: string;
	execute: (
		toolCallId: string,
		params: unknown,
		signal: unknown,
		onUpdate: unknown,
		ctx: unknown,
	) => Promise<{ terminate?: boolean; details?: Record<string, unknown> }>;
}
type HookHandler = (event: unknown, ctx: unknown) => unknown;

function createRealRuntimeHarness() {
	const sessionManager = SessionManager.inMemory(process.cwd());
	if (typeof sessionManager.getSessionId === "function") {
		if (!sessionManager.getSessionId() && sessionManager.newSession) {
			sessionManager.newSession();
		}
	}

	const commands = new Map<string, RegisteredCommand>();
	const tools = new Map<string, RegisteredTool>();
	const hooks = new Map<string, HookHandler>();
	const sentMessages: Array<{ prompt: string }> = [];
	const extensionErrors: unknown[] = [];

	const pi = {
		registerCommand(name: string, command: RegisteredCommand) {
			commands.set(name, command);
		},
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		on(hook: string, handler: HookHandler) {
			hooks.set(hook, handler);
		},
		// Real leaf-advancing persistence: goal entries go through the actual
		// SessionManager, exactly like Pi wires the extension's appendEntry.
		appendEntry(customType: string, data?: unknown) {
			return sessionManager.appendCustomEntry(customType, data);
		},
		sendUserMessage(prompt: string) {
			sentMessages.push({ prompt });
		},
	};

	// Mirror Pi 0.80.3's extension context: sessionManager is the REAL manager
	// (no goalProtocol field), plus stubbed model/UI that the bugs never
	// touched.
	const ctx = {
		hasUI: false,
		isIdle: () => true,
		hasPendingMessages: () => false,
		waitForIdle: async () => {},
		sessionManager,
		modelRegistry: {
			find: () => undefined,
			getApiKeyAndHeaders: async () => ({ ok: false }),
		},
		signal: undefined,
		ui: {
			notify: () => {},
			confirm: async () => true,
			editor: async () => undefined,
			setStatus: () => {},
			setWidget: () => {},
		},
	};

	// Simulate what Pi's agent loop does between tool calls: it persists the
	// tool call/result as entries, which advances the session leaf.
	function advanceLeaf() {
		sessionManager.appendCustomEntry("thread-goal-e2e-turn", {
			marker: "tool-result",
		});
	}

	async function runTool(name: string, params: unknown) {
		const tool = tools.get(name);
		if (!tool) throw new Error(`tool not registered: ${name}`);
		return tool.execute(name, params, undefined, undefined, ctx);
	}

	return {
		sessionManager,
		pi: pi as unknown as Parameters<typeof goalExtension>[0],
		ctx,
		commands,
		tools,
		hooks,
		sentMessages,
		extensionErrors,
		advanceLeaf,
		runTool,
		async fireHook(hook: string, event: unknown) {
			const handler = hooks.get(hook);
			if (!handler) return undefined;
			try {
				return await handler(event, ctx);
			} catch (error) {
				extensionErrors.push(error);
				throw error;
			}
		},
	};
}

describe("extension against the real Pi runtime", () => {
	it("binds to a real session without a host-provided goalProtocol", async () => {
		const h = createRealRuntimeHarness();
		goalExtension(h.pi);

		// The real ctx has no goalProtocol field. session_start is where the
		// v0.5.0 build threw "Goal protocol requires explicit sessionId and
		// branchId context." Binding must now succeed.
		await expect(
			h.fireHook("session_start", { reason: "startup" }),
		).resolves.not.toThrow();
		expect(h.extensionErrors).toHaveLength(0);
		expect(h.commands.has("goal")).toBe(true);
	});

	it("creates and completes a goal as the real session leaf advances", async () => {
		const h = createRealRuntimeHarness();
		goalExtension(h.pi);

		const leafBefore = h.sessionManager.getLeafId();
		await h.commands
			.get("goal")
			?.handler("ship the real-runtime harness", h.ctx);

		// The goal was persisted through the real SessionManager and the leaf
		// advanced.
		const created = loadGoalState(h.ctx);
		expect(created?.objective).toBe("ship the real-runtime harness");
		expect(created?.status).toBe("active");
		expect(h.sessionManager.getLeafId()).not.toBe(leafBefore);
		expect(
			h.sessionManager
				.getBranch()
				.some(
					(e) => (e as { customType?: string }).customType === GOAL_CUSTOM_TYPE,
				),
		).toBe(true);
		expect(h.sentMessages.length).toBeGreaterThan(0);

		// The get_goal -> prepare_goal_completion -> complete_goal handshake,
		// with the real leaf advancing between every call like a live turn.
		await h.runTool("get_goal", {});
		h.advanceLeaf();
		const leafAtPrepare = h.sessionManager.getLeafId();

		const prepared = await h.runTool("prepare_goal_completion", {
			evidence: "harness wired to the real SessionManager and verified",
		});
		expect(prepared.details?.protocol).toBeDefined();
		h.advanceLeaf();
		// The leaf really did move between get_goal and the mutation.
		expect(h.sessionManager.getLeafId()).not.toBe(leafAtPrepare);

		const completed = await h.runTool("complete_goal", {
			evidence: "harness wired to the real SessionManager and verified",
		});
		expect(completed.terminate).toBeUndefined();
		expect(completed.details?.requiresFinalResponse).toBe(true);

		expect(loadGoalState(h.ctx)?.status).toBe("complete");
	});
});
