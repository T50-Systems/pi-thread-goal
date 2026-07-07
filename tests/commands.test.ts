import { describe, expect, it, vi } from "vitest";
import {
	handleGoalCommand,
	parseGoalCommand,
	parseGoalEditDocument,
	parseTokenBudgetValue,
	renderGoalEditDocument,
} from "../src/commands.js";
import { GOAL_CUSTOM_TYPE } from "../src/goal-state-persistence.js";

describe("parseGoalCommand", () => {
	it("shows when empty", () => {
		expect(parseGoalCommand("")).toEqual({
			kind: "show",
			confirmed: false,
			replace: false,
			start: false,
		});
	});

	it("parses create with flags", () => {
		expect(parseGoalCommand("ship onboarding --replace --start")).toEqual({
			kind: "create",
			objective: "ship onboarding",
			confirmed: false,
			replace: true,
			start: true,
		});
	});

	it("parses token budget flags", () => {
		expect(parseGoalCommand("ship onboarding --tokens 100k")).toEqual({
			kind: "create",
			objective: "ship onboarding",
			confirmed: false,
			replace: false,
			start: false,
			tokenBudget: 100_000,
		});
		expect(parseGoalCommand("ship onboarding --tokens=1m --replace")).toEqual({
			kind: "create",
			objective: "ship onboarding",
			confirmed: false,
			replace: true,
			start: false,
			tokenBudget: 1_000_000,
		});
	});

	it("normalizes token budget values", () => {
		expect(parseTokenBudgetValue("100k")).toBe(100_000);
		expect(parseTokenBudgetValue("1.5m")).toBe(1_500_000);
		expect(parseTokenBudgetValue("12,345")).toBe(12_345);
		expect(parseTokenBudgetValue("nope")).toBeUndefined();
	});

	it("parses control commands", () => {
		expect(parseGoalCommand("resume")).toEqual({
			kind: "resume",
			confirmed: false,
			replace: false,
			start: true,
		});
		expect(parseGoalCommand("resume --no-start")).toEqual({
			kind: "resume",
			confirmed: false,
			replace: false,
			start: false,
		});
		expect(parseGoalCommand("resume --start")).toEqual({
			kind: "resume",
			confirmed: false,
			replace: false,
			start: true,
		});
		expect(parseGoalCommand("doctor")).toEqual({
			kind: "doctor",
			confirmed: false,
			replace: false,
			start: false,
		});
	});

	it("parses dismiss", () => {
		expect(parseGoalCommand("dismiss")).toEqual({
			kind: "dismiss",
			confirmed: false,
			replace: false,
			start: false,
		});
	});

	it("parses widget toggle commands", () => {
		expect(parseGoalCommand("toggle")).toEqual({
			kind: "toggle",
			confirmed: false,
			replace: false,
			start: false,
		});
		expect(parseGoalCommand("expand")).toEqual({
			kind: "expand",
			confirmed: false,
			replace: false,
			start: false,
		});
		expect(parseGoalCommand("collapse")).toEqual({
			kind: "collapse",
			confirmed: false,
			replace: false,
			start: false,
		});
	});
});

type TestBranchEntry = { type: string; customType?: string; data?: unknown };

function makePausedGoalHarness() {
	const branch: TestBranchEntry[] = [
		{
			type: "custom",
			customType: GOAL_CUSTOM_TYPE,
			data: {
				action: "create",
				state: null,
				event: {
					action: "create",
					goalId: "g1",
					objective: "ship resumed work",
					now: 1,
				},
			},
		},
		{
			type: "custom",
			customType: GOAL_CUSTOM_TYPE,
			data: {
				action: "pause",
				state: null,
				event: { action: "pause", goalId: "g1", now: 2 },
			},
		},
	];
	const pi = {
		appendEntry: vi.fn((customType: string, data: unknown) => {
			branch.push({ type: "custom", customType, data });
		}),
		sendUserMessage: vi.fn(),
	};
	const ctx = {
		hasUI: false,
		isIdle: vi.fn(() => true),
		waitForIdle: vi.fn(async () => {}),
		sessionManager: { getBranch: vi.fn(() => branch) },
		ui: {
			notify: vi.fn(),
			confirm: vi.fn(),
			editor: vi.fn(),
			setStatus: vi.fn(),
			setWidget: vi.fn(),
		},
	};
	return {
		pi: pi as Parameters<typeof handleGoalCommand>[0],
		ctx,
		sendUserMessage: pi.sendUserMessage,
	};
}

describe("handleGoalCommand resume", () => {
	it("starts the next goal turn by default", async () => {
		const { pi, ctx, sendUserMessage } = makePausedGoalHarness();

		await handleGoalCommand(pi, "resume", ctx);

		expect(sendUserMessage).toHaveBeenCalledTimes(1);
		expect(String(sendUserMessage.mock.calls[0][0])).toContain(
			"ship resumed work",
		);
	});

	it("can resume state without starting when --no-start is provided", async () => {
		const { pi, ctx, sendUserMessage } = makePausedGoalHarness();

		await handleGoalCommand(pi, "resume --no-start", ctx);

		expect(sendUserMessage).not.toHaveBeenCalled();
	});
});

describe("goal edit document", () => {
	it("renders and parses objective, criteria, and paths", () => {
		const document = renderGoalEditDocument({
			version: 1,
	revision: 1,
			goalId: "g1",
			objective: "ship goal editing",
			status: "active",
			acceptanceCriteria: ["edit objective", "edit metadata"],
			sourcePaths: ["src/commands.ts"],
			progress: { done: [], blocked: [], summary: "" },
			createdAt: 1,
			updatedAt: 1,
			runStartedAt: 1,
			evaluationTurns: 0,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			lastEvaluationReason: "Goal started.",
		});

		expect(document).toContain("Objective:\nship goal editing");
		expect(document).toContain("- edit objective");
		expect(document).toContain("Token budget:");

		expect(parseGoalEditDocument(document)).toEqual({
			objective: "ship goal editing",
			acceptanceCriteria: ["edit objective", "edit metadata"],
			sourcePaths: ["src/commands.ts"],
		});
	});

	it("renders and parses token budget", () => {
		const document = renderGoalEditDocument({
			version: 1,
	revision: 1,
			goalId: "g1",
			objective: "ship goal editing",
			status: "active",
			acceptanceCriteria: [],
			sourcePaths: [],
			tokenBudget: 100_000,
			progress: { done: [], blocked: [], summary: "" },
			createdAt: 1,
			updatedAt: 1,
			runStartedAt: 1,
			evaluationTurns: 0,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			lastEvaluationReason: "Goal started.",
		});

		expect(parseGoalEditDocument(document).tokenBudget).toBe(100_000);
	});

	it("deduplicates and trims editable lists", () => {
		expect(
			parseGoalEditDocument(
				[
					"Objective:",
					"ship",
					"",
					"Acceptance criteria:",
					"- tests",
					"* tests",
					"  docs  ",
					"",
					"Source paths:",
					"- src/commands.ts",
				].join("\n"),
			),
		).toEqual({
			objective: "ship",
			acceptanceCriteria: ["tests", "docs"],
			sourcePaths: ["src/commands.ts"],
		});
	});
});
