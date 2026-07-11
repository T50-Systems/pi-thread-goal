import { describe, expect, it, vi } from "vitest";
import {
	type GoalActionAPI,
	type GoalCommandContext,
	handleGoalCommand,
} from "../src/commands.js";
import {
	type GoalSessionEntry,
	loadGoalState,
	saveGoalState,
} from "../src/goal-state-persistence.js";

function createHarness(options: { hasUI?: boolean } = {}) {
	const branch: GoalSessionEntry[] = [];
	const pi = {
		appendEntry(customType: string, data?: unknown) {
			branch.push({ type: "custom", customType, data });
		},
		sendUserMessage: vi.fn(),
	} satisfies GoalActionAPI;
	const ui = {
		notify: vi.fn(),
		confirm: vi.fn(async () => true),
		editor: vi.fn<GoalCommandContext["ui"]["editor"]>(),
		setStatus: vi.fn(),
		setWidget: vi.fn(),
	};
	const ctx = {
		hasUI: options.hasUI ?? true,
		isIdle: () => true,
		hasPendingMessages: () => false,
		waitForIdle: vi.fn(async () => {}),
		sessionManager: { getBranch: () => branch },
		ui,
	} satisfies GoalCommandContext;
	return { branch, ctx, pi, ui };
}

function seedGoal(harness: ReturnType<typeof createHarness>) {
	const state = saveGoalState(
		harness.pi,
		{
			action: "create",
			goalId: "existing-goal",
			objective: "Original objective",
			now: 1,
		},
		null,
	);
	if (!state) throw new Error("Expected seeded goal state.");
	harness.pi.sendUserMessage.mockClear();
	return state;
}

describe("goal command mutations", () => {
	it("creates and starts a goal", async () => {
		const harness = createHarness();

		await handleGoalCommand(
			harness.pi,
			"Ship the release --tokens 100k",
			harness.ctx,
		);

		const state = loadGoalState(harness.ctx);
		expect(state).toMatchObject({
			objective: "Ship the release",
			tokenBudget: 100_000,
			status: "active",
		});
		expect(harness.pi.sendUserMessage).toHaveBeenCalledOnce();
		expect(harness.ui.notify).toHaveBeenCalledWith("Goal created.", "info");
	});

	it("replaces an existing goal when explicitly authorized", async () => {
		const harness = createHarness();
		const original = seedGoal(harness);

		await handleGoalCommand(
			harness.pi,
			"Replacement objective --replace",
			harness.ctx,
		);

		const state = loadGoalState(harness.ctx);
		expect(state?.goalId).not.toBe(original.goalId);
		expect(state?.objective).toBe("Replacement objective");
		expect(harness.ui.confirm).not.toHaveBeenCalled();
		expect(harness.ui.notify).toHaveBeenCalledWith("Goal replaced.", "info");
	});

	it("cancels an interactive replacement without mutating state", async () => {
		const harness = createHarness();
		const original = seedGoal(harness);
		harness.ui.confirm.mockResolvedValueOnce(false);

		await handleGoalCommand(harness.pi, "Replacement objective", harness.ctx);

		expect(loadGoalState(harness.ctx)).toEqual(original);
		expect(harness.ui.notify).toHaveBeenCalledWith(
			"Goal replacement cancelled.",
			"info",
		);
	});

	it("rejects replacement without confirmation in a non-interactive host", async () => {
		const harness = createHarness({ hasUI: false });
		const original = seedGoal(harness);

		await handleGoalCommand(harness.pi, "Replacement objective", harness.ctx);

		expect(loadGoalState(harness.ctx)).toEqual(original);
		expect(harness.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("requires confirmation"),
			"error",
		);
	});

	it("edits objective, criteria, paths, and token budget", async () => {
		const harness = createHarness();
		seedGoal(harness);
		harness.ui.editor.mockResolvedValueOnce(
			[
				"Objective:",
				"Edited objective",
				"",
				"Acceptance criteria:",
				"- tests pass",
				"",
				"Source paths:",
				"- src/commands.ts",
				"",
				"Token budget:",
				"25000",
			].join("\n"),
		);

		await handleGoalCommand(harness.pi, "edit", harness.ctx);

		expect(loadGoalState(harness.ctx)).toMatchObject({
			objective: "Edited objective",
			acceptanceCriteria: ["tests pass"],
			sourcePaths: ["src/commands.ts"],
			tokenBudget: 25_000,
		});
		expect(harness.ui.notify).toHaveBeenCalledWith("Goal updated.", "info");
	});

	it("cancels editing when the editor closes without a value", async () => {
		const harness = createHarness();
		const original = seedGoal(harness);
		harness.ui.editor.mockResolvedValueOnce(undefined);

		await handleGoalCommand(harness.pi, "edit", harness.ctx);

		expect(loadGoalState(harness.ctx)).toEqual(original);
		expect(harness.ui.notify).toHaveBeenCalledWith(
			"Goal edit cancelled.",
			"info",
		);
	});

	it("clears a goal with an explicit non-interactive confirmation flag", async () => {
		const harness = createHarness({ hasUI: false });
		seedGoal(harness);

		await handleGoalCommand(harness.pi, "clear --yes", harness.ctx);

		expect(loadGoalState(harness.ctx)).toBeNull();
		expect(harness.ui.notify).toHaveBeenCalledWith("Goal cleared.", "info");
	});

	it("rejects a destructive clear without non-interactive confirmation", async () => {
		const harness = createHarness({ hasUI: false });
		const original = seedGoal(harness);

		await handleGoalCommand(harness.pi, "clear", harness.ctx);

		expect(loadGoalState(harness.ctx)).toEqual(original);
		expect(harness.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("requires confirmation"),
			"error",
		);
	});
});
