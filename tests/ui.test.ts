import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyGoalUi,
	formatElapsedTime,
	renderGoalOverlayLines,
	renderGoalStatusLine,
	renderGoalWidget,
	setGoalWidgetExpanded,
	toggleGoalWidgetExpanded,
} from "../src/ui.js";
import type { GoalState } from "../src/types.js";

const baseGoal: GoalState = {
	version: 1,
	goalId: "g1",
	objective: "ship",
	status: "active",
	acceptanceCriteria: [],
	sourcePaths: [],
	progress: { done: [], blocked: [], summary: "working" },
	createdAt: 1,
	updatedAt: 1,
	runStartedAt: 1,
	evaluationTurns: 0,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	lastEvaluationReason: "working",
};

function plain(line: string): string {
	return line.replace(/\x1B\[[0-9;]*m/g, "").trim();
}

beforeEach(() => {
	setGoalWidgetExpanded(false);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("applyGoalUi", () => {
	it("keeps completed goals visible until dismissed", () => {
		const setStatus = vi.fn();
		const setWidget = vi.fn();
		applyGoalUi(
			{ ui: { setStatus, setWidget } },
			{ ...baseGoal, status: "complete" },
		);
		expect(setStatus).toHaveBeenCalledWith("goal", undefined);
		expect(setWidget).toHaveBeenCalledWith(
			"goal",
			expect.arrayContaining([expect.stringContaining("Goal (complete)")]),
		);
	});

	it("hides the widget after the goal is dismissed", () => {
		const setWidget = vi.fn();
		applyGoalUi(
			{ ui: { setWidget } },
			{ ...baseGoal, status: "complete", dismissedAt: 2 },
		);
		expect(setWidget).toHaveBeenCalledWith("goal", undefined);
	});

	it("renders the expanded persistent widget when toggled", () => {
		const setStatus = vi.fn();
		const setWidget = vi.fn();
		setGoalWidgetExpanded(true);

		applyGoalUi(
			{ ui: { setStatus, setWidget } },
			{
				...baseGoal,
				acceptanceCriteria: ["open", "toggle"],
				sourcePaths: ["src/ui.ts", "src/commands.ts"],
				progress: {
					done: ["compact widget", "overlay"],
					blocked: ["manual validation"],
					summary: "Most implementation is done.",
					current: "Verify the persistent widget.",
				},
			},
		);

		const lines = setWidget.mock.calls[0][1] as string[];
		const plainLines = lines.map(plain);
		expect(lines[0]).toContain("\x1b[48;5;236m");
		expect(plainLines[0]).toContain("expanded");
		expect(plainLines.some((line) => line.startsWith("Done:"))).toBe(true);
		expect(plainLines.some((line) => line.startsWith("Criteria:"))).toBe(true);
	});
});

describe("renderGoalStatusLine", () => {
	it("can still render a terse status line for callers that opt in", () => {
		const text = renderGoalStatusLine({
			...baseGoal,
			objective:
				"Me gustaria que trabajes uno a uno todos los issues abiertos y a cada uno le crees sus pr y los mergees",
			progress: {
				done: [],
				blocked: [],
				summary: "7 issues completados; sigo con el siguiente.",
				current: "Preparando PR para el issue #4.",
			},
		});

		expect(text).toBe("/goal active · Preparando PR para el issue #4.");
		expect(text).not.toContain("Me gustaria");
	});
});

describe("formatElapsedTime", () => {
	it("formats goal elapsed time compactly", () => {
		expect(formatElapsedTime(0, 45_000)).toBe("45s");
		expect(formatElapsedTime(0, 93 * 60_000 + 12_000)).toBe("1h 33m 12s");
		expect(formatElapsedTime(0, 26 * 60 * 60_000 + 3 * 60_000 + 4_000)).toBe(
			"1d 2h 3m 4s",
		);
	});
});

describe("renderGoalWidget", () => {
	it("renders a more compact widget", () => {
		const now = Date.UTC(2026, 0, 1, 12, 0, 0);
		vi.useFakeTimers();
		vi.setSystemTime(now);
		const lines = renderGoalWidget({
			...baseGoal,
			objective:
				"Me gustaria que trabajes uno a uno todos los issues abiertos y a cada uno le crees sus pr y los mergees",
			evaluationTurns: 3,
			usage: { ...baseGoal.usage, total: 16_251_870 },
			runStartedAt: now - (93 * 60_000 + 12_000),
			lastEvaluationReason: "No hay evidencia...",
			progress: {
				done: [],
				blocked: [],
				summary:
					"7 issues completados bajo el objetivo actual con trazabilidad GitHub real. Continúo con #631; el backlog completo aún no está terminado.",
				current:
					"Siguiente issue abierto a trabajar: #631 ([UC-E31-S009] Integración Meta/Facebook).",
			},
		});
		const plainLines = lines.map(plain);
		expect(lines.every((line) => line.includes("\x1b[48;5;236m"))).toBe(true);
		expect(plainLines[0]).toBe("Goal (active)");
		expect(plainLines[2]).toBe("Turns 3 · Time 1h 33m 12s · Tokens 16.3M");
		expect(lines.length).toBeLessThanOrEqual(4);
	});

	it("renders token budget alongside token usage", () => {
		const lines = renderGoalWidget({
			...baseGoal,
			tokenBudget: 100_000,
			usage: { ...baseGoal.usage, total: 50_000 },
		});

		expect(lines.map(plain)[2]).toContain("Tokens 50.0k/100.0k");
	});

	it("renders richer detail when expanded", () => {
		const lines = renderGoalWidget(
			{
				...baseGoal,
				acceptanceCriteria: ["panel opens", "panel toggles"],
				sourcePaths: ["src/ui.ts", "src/commands.ts", "tests/ui.test.ts"],
				progress: {
					done: ["compact widget", "overlay renderer"],
					blocked: ["manual TUI validation pending"],
					summary: "Most implementation is done.",
					current: "Validate the overlay in Pi.",
				},
			},
			true,
		);

		const plainLines = lines.map(plain);
		expect(plainLines[0]).toContain("expanded");
		expect(plainLines.some((line) => line.startsWith("Done:"))).toBe(true);
		expect(plainLines.some((line) => line.startsWith("Blocked:"))).toBe(true);
		expect(plainLines.some((line) => line.startsWith("Criteria:"))).toBe(true);
		expect(plainLines.some((line) => line.startsWith("Paths:"))).toBe(true);
	});
});

describe("renderGoalOverlayLines", () => {
	it("renders a collapsed overlay within width", () => {
		const lines = renderGoalOverlayLines(
			{
				...baseGoal,
				objective:
					"Ship the interactive goal panel with compact default state and richer details on demand.",
				evaluationTurns: 3,
				usage: { ...baseGoal.usage, total: 12_540 },
				progress: {
					done: ["Compact widget"],
					blocked: [],
					summary: "Overlay panel in progress",
					current: "Wire /goal status to open the panel.",
				},
			},
			false,
			48,
		);

		expect(lines.some((line) => line.includes("Goal · active"))).toBe(true);
		expect(lines.some((line) => line.includes("Enter/Space expand"))).toBe(
			true,
		);
		expect(lines.every((line) => line.length <= 48)).toBe(true);
	});

	it("renders expanded details", () => {
		const lines = renderGoalOverlayLines(
			{
				...baseGoal,
				acceptanceCriteria: ["panel opens", "panel toggles"],
				sourcePaths: ["src/ui.ts", "src/commands.ts", "tests/ui.test.ts"],
				progress: {
					done: ["compact widget", "overlay renderer"],
					blocked: ["manual TUI validation pending"],
					summary: "Most implementation is done.",
					current: "Validate the overlay in Pi.",
				},
			},
			true,
			56,
		);

		expect(lines.some((line) => line.includes("Done:"))).toBe(true);
		expect(lines.some((line) => line.includes("Blocked:"))).toBe(true);
		expect(lines.some((line) => line.includes("Acceptance criteria:"))).toBe(
			true,
		);
		expect(lines.some((line) => line.includes("Paths:"))).toBe(true);
		expect(lines.some((line) => line.includes("Enter/Space collapse"))).toBe(
			true,
		);
	});

	it("falls back to plain text when theme color helpers throw", () => {
		expect(() =>
			renderGoalOverlayLines(baseGoal, false, 48, {
				fg: () => {
					throw new TypeError(
						"Cannot read properties of undefined (reading 'fgColors')",
					);
				},
				bold: (text) => text,
			}),
		).not.toThrow();
	});
});

describe("toggleGoalWidgetExpanded", () => {
	it("toggles between collapsed and expanded", () => {
		expect(toggleGoalWidgetExpanded()).toBe(true);
		expect(toggleGoalWidgetExpanded()).toBe(false);
	});
});
