import { describe, expect, it, vi } from "vitest";
import {
	formatGoal,
	formatGoalProgressUpdate,
	registerGoalTools,
	validateGoalCompletion,
} from "../src/tools.js";
import type { GoalState } from "../src/types.js";

const goal: GoalState = {
	version: 1,
	revision: 1,
	goalId: "g1",
	objective: "ship the feature",
	status: "active",
	acceptanceCriteria: [],
	sourcePaths: [],
	progress: {
		done: [],
		blocked: [],
		summary: "tests are green",
		current: "write docs",
	},
	createdAt: 1,
	updatedAt: 1,
	runStartedAt: 1,
	evaluationTurns: 2,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	lastEvaluationReason: "keep going",
};

describe("goal tool user-facing text", () => {
	it("keeps get_goal output concise and avoids echoing the full objective", () => {
		const text = formatGoal(goal);

		expect(text).toContain("/goal active");
		expect(text).toContain("Now: write docs");
		expect(text).not.toContain(goal.objective);
		expect(text).not.toContain("Evaluator");
	});

	it("uses a quiet progress acknowledgement", () => {
		expect(formatGoalProgressUpdate(goal)).toBe("Progress noted.");
	});
});

describe("goal completion validation", () => {
	it("rejects blockers and missing evidence", () => {
		expect(
			validateGoalCompletion(
				{
					...goal,
					progress: { ...goal.progress, blocked: ["waiting on tests"] },
				},
				"tests passed",
			),
		).toEqual({
			ok: false,
			reason:
				"Cannot complete goal with unresolved blockers: waiting on tests.",
		});
		expect(
			validateGoalCompletion(
				{
					...goal,
					acceptanceCriteria: ["tests pass"],
					progress: { done: [], blocked: [], summary: "" },
				},
				undefined,
			).ok,
		).toBe(false);
	});

	it("allows clean completion with evidence", () => {
		expect(
			validateGoalCompletion(
				{
					...goal,
					acceptanceCriteria: ["tests pass"],
					progress: {
						done: ["write docs"],
						blocked: [],
						summary: "tests passed",
						current: "write docs",
					},
				},
				"tests passed and criteria completed",
			),
		).toEqual({ ok: true });
	});
});

describe("registered goal tools", () => {
	it("documents blocked as real operational blockers only", () => {
		const tools = new Map<string, any>();
		registerGoalTools({
			registerTool: (tool: any) => tools.set(tool.name, tool),
			appendEntry: vi.fn(),
		} as any);
		const tool = tools.get("update_goal_progress");

		expect(tool.promptGuidelines.join("\n")).toContain(
			"Use blocked only for real operational blockers",
		);
		expect(JSON.stringify(tool.parameters)).toContain(
			"Do not list risks or uncertainty here",
		);
	});

	it("documents get_goal before every goal-state mutation", () => {
		const tools = new Map<string, any>();
		registerGoalTools({
			registerTool: (tool: any) => tools.set(tool.name, tool),
			appendEntry: vi.fn(),
		} as any);

		expect(tools.get("get_goal").promptSnippet).toContain(
			"Call get_goal immediately before update_goal_progress",
		);
		expect(
			tools.get("update_goal_progress").promptGuidelines.join("\n"),
		).toContain("After update_goal_progress succeeds, call get_goal again");
		expect(tools.get("prepare_goal_completion").promptSnippet).toContain(
			"if update_goal_progress just ran, call get_goal again first",
		);
		expect(tools.get("complete_goal").promptGuidelines.join("\n")).toContain(
			"If update_goal_progress ran earlier in the turn, call get_goal again",
		);
		expect(tools.get("complete_goal").promptGuidelines.join("\n")).toContain(
			"send a final visible message",
		);
	});

	it("warns when blocked entries look like technical risk", async () => {
		const tools = new Map<string, any>();
		const branchEntries: any[] = [
			{
				type: "custom",
				customType: "thread-goal-state",
				data: {
					action: "create",
					event: { action: "create", goalId: "g1", objective: "ship", now: 1 },
					state: null,
				},
			},
		];
		const appendEntry = vi.fn((customType: string, data: unknown) =>
			branchEntries.push({ type: "custom", customType, data }),
		);
		registerGoalTools({
			registerTool: (tool: any) => tools.set(tool.name, tool),
			appendEntry,
		} as any);
		const ctx = {
			sessionManager: {
				getBranch: () => branchEntries,
				sessionId: "risk-session",
				leafId: "test-branch",
			},
		};

		await tools.get("get_goal").execute("tc0", {}, undefined, undefined, ctx);
		const result = await tools
			.get("update_goal_progress")
			.execute(
				"tc1",
				{ blocked: ["Full complex-script/ZWJ shaping likely needs HarfBuzz"] },
				undefined,
				undefined,
				ctx,
			);

		expect(result.details.blockerWarning.items).toEqual([
			"Full complex-script/ZWJ shaping likely needs HarfBuzz",
		]);
	});

	it("requires prepare_goal_completion before complete_goal", async () => {
		const tools = new Map<string, any>();
		const branchEntries: any[] = [
			{
				type: "custom",
				customType: "thread-goal-state",
				data: {
					action: "create",
					event: { action: "create", goalId: "g1", objective: "ship", now: 1 },
					state: null,
				},
			},
		];
		const appendEntry = vi.fn((customType: string, data: unknown) =>
			branchEntries.push({ type: "custom", customType, data }),
		);
		registerGoalTools({
			registerTool: (tool: any) => tools.set(tool.name, tool),
			appendEntry,
		} as any);
		const ctx = {
			sessionManager: {
				getBranch: () => branchEntries,
				sessionId: "test-session",
				leafId: "test-branch",
			},
		};

		await expect(
			tools
				.get("complete_goal")
				.execute(
					"tc1",
					{ evidence: "done and tests passed" },
					undefined,
					undefined,
					ctx,
				),
		).rejects.toThrow("Completion requires a fresh completion candidate");

		const observed = await tools
			.get("get_goal")
			.execute("tc2", {}, undefined, undefined, ctx);
		const prepared = await tools
			.get("prepare_goal_completion")
			.execute(
				"tc3",
				{ evidence: "done and tests passed" },
				undefined,
				undefined,
				ctx,
			);
		expect(observed.details.observation_token).toBeUndefined();
		expect(prepared.details.completion_token).toBeUndefined();
		expect(JSON.stringify(prepared.details.protocol)).not.toContain(
			"done and tests passed",
		);
		const result = await tools
			.get("complete_goal")
			.execute(
				"tc4",
				{ evidence: "done and tests passed" },
				undefined,
				undefined,
				ctx,
			);

		expect(result.terminate).toBeUndefined();
		expect(result.details.requiresFinalResponse).toBe(true);
		expect(result.content[0].text).toContain(
			"send a final visible user message",
		);
		expect(result.details.goal.status).toBe("complete");
		expect(result.details.goal.revision).toBe(2);
		expect(appendEntry).toHaveBeenCalledTimes(1);
	});

	it("authorizes the completion handshake as the session leaf advances", async () => {
		// Reproduces the real Pi failure: the session leaf advances on every
		// appended entry, so get_goal and the mutating tools each observe a
		// different leafId within one turn. The capability key must not move
		// with the leaf, or prepare_goal_completion is rejected with
		// "Call get_goal before mutating goal state." immediately after get_goal.
		const tools = new Map<string, any>();
		const branchEntries: any[] = [
			{
				type: "custom",
				customType: "thread-goal-state",
				data: {
					action: "create",
					event: { action: "create", goalId: "g1", objective: "ship", now: 1 },
					state: null,
				},
			},
		];
		const appendEntry = vi.fn((customType: string, data: unknown) =>
			branchEntries.push({ type: "custom", customType, data }),
		);
		registerGoalTools({
			registerTool: (tool: any) => tools.set(tool.name, tool),
			appendEntry,
		} as any);
		let leaf = 0;
		const ctx = {
			sessionManager: {
				getBranch: () => branchEntries,
				sessionId: "leaf-advance-session",
				// A fresh, advancing leaf id on every read, like real Pi.
				get leafId() {
					leaf += 1;
					return `leaf-${leaf}`;
				},
			},
		};

		await tools.get("get_goal").execute("tc0", {}, undefined, undefined, ctx);
		const prepared = await tools
			.get("prepare_goal_completion")
			.execute(
				"tc1",
				{ evidence: "done and tests passed" },
				undefined,
				undefined,
				ctx,
			);
		expect(prepared.details.protocol).toBeDefined();
		const result = await tools
			.get("complete_goal")
			.execute(
				"tc2",
				{ evidence: "done and tests passed" },
				undefined,
				undefined,
				ctx,
			);
		expect(result.terminate).toBeUndefined();
		expect(result.details.goal.status).toBe("complete");
		expect(result.details.requiresFinalResponse).toBe(true);
	});

	it("rejects no-op progress updates without appending", async () => {
		const tools = new Map<string, any>();
		const branchEntries: any[] = [
			{
				type: "custom",
				customType: "thread-goal-state",
				data: {
					action: "create",
					event: { action: "create", goalId: "g1", objective: "ship", now: 1 },
					state: null,
				},
			},
		];
		const appendEntry = vi.fn((customType: string, data: unknown) =>
			branchEntries.push({ type: "custom", customType, data }),
		);
		registerGoalTools({
			registerTool: (tool: any) => tools.set(tool.name, tool),
			appendEntry,
		} as any);
		const ctx = {
			sessionManager: {
				getBranch: () => branchEntries,
				sessionId: "noop-session",
				leafId: "test-branch",
			},
		};

		await tools.get("get_goal").execute("tc0", {}, undefined, undefined, ctx);
		await expect(
			tools
				.get("update_goal_progress")
				.execute("tc1", {}, undefined, undefined, ctx),
		).rejects.toThrow("Progress update must include at least one field");

		expect(appendEntry).not.toHaveBeenCalled();
	});

	it("rejects stale tool calls against paused goals", async () => {
		const tools = new Map<string, any>();
		const branchEntries: any[] = [
			{
				type: "custom",
				customType: "thread-goal-state",
				data: {
					action: "create",
					event: { action: "create", goalId: "g1", objective: "ship", now: 1 },
					state: null,
				},
			},
			{
				type: "custom",
				customType: "thread-goal-state",
				data: {
					action: "pause",
					event: { action: "pause", goalId: "g1", now: 2 },
					state: null,
				},
			},
		];
		const appendEntry = vi.fn();
		registerGoalTools({
			registerTool: (tool: any) => tools.set(tool.name, tool),
			appendEntry,
		} as any);

		const ctx = {
			sessionManager: {
				getBranch: () => branchEntries,
				sessionId: "test-session",
				leafId: "test-branch",
			},
		};
		const observed = await tools
			.get("get_goal")
			.execute("tc0", {}, undefined, undefined, ctx);
		expect(observed.details.capability?.observed).toBe(false);

		await expect(
			tools
				.get("update_goal_progress")
				.execute(
					"tc1",
					{ summary: "still working" },
					undefined,
					undefined,
					ctx,
				),
		).rejects.toThrow("Goal is not active; current status is paused.");
		expect(appendEntry).not.toHaveBeenCalled();
	});
});
