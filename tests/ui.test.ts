import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyGoalUi,
  renderGoalOverlayLines,
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

beforeEach(() => {
  setGoalWidgetExpanded(false);
});

describe("applyGoalUi", () => {
  it("hides the widget when goal is complete", () => {
    const setStatus = vi.fn();
    const setWidget = vi.fn();
    applyGoalUi(
      { ui: { setStatus, setWidget } },
      { ...baseGoal, status: "complete" },
    );
    expect(setStatus).toHaveBeenCalledWith("goal", expect.stringContaining("/goal complete"));
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
    expect(lines[0]).toContain("expanded");
    expect(lines.some((line) => line.startsWith("Done:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Criteria:"))).toBe(true);
  });
});

describe("renderGoalWidget", () => {
  it("renders a more compact widget", () => {
    const lines = renderGoalWidget({
      ...baseGoal,
      objective: "Me gustaria que trabajes uno a uno todos los issues abiertos y a cada uno le crees sus pr y los mergees",
      evaluationTurns: 3,
      usage: { ...baseGoal.usage, total: 16_251_870 },
      lastEvaluationReason: "No hay evidencia...",
      progress: {
        done: [],
        blocked: [],
        summary: "7 issues completados bajo el objetivo actual con trazabilidad GitHub real. Continúo con #631; el backlog completo aún no está terminado.",
        current: "Siguiente issue abierto a trabajar: #631 ([UC-E31-S009] Integración Meta/Facebook).",
      },
    });
    expect(lines[0]).toBe("Goal (active)");
    expect(lines[2]).toBe("Turns 3 · Tokens 16.3M");
    expect(lines.length).toBeLessThanOrEqual(4);
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

    expect(lines[0]).toContain("expanded");
    expect(lines.some((line) => line.startsWith("Done:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Blocked:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Criteria:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Paths:"))).toBe(true);
  });
});

describe("renderGoalOverlayLines", () => {
  it("renders a collapsed overlay within width", () => {
    const lines = renderGoalOverlayLines(
      {
        ...baseGoal,
        objective: "Ship the interactive goal panel with compact default state and richer details on demand.",
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
    expect(lines.some((line) => line.includes("Enter/Space expand"))).toBe(true);
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
    expect(lines.some((line) => line.includes("Acceptance criteria:"))).toBe(true);
    expect(lines.some((line) => line.includes("Paths:"))).toBe(true);
    expect(lines.some((line) => line.includes("Enter/Space collapse"))).toBe(true);
  });
});

describe("toggleGoalWidgetExpanded", () => {
  it("toggles between collapsed and expanded", () => {
    expect(toggleGoalWidgetExpanded()).toBe(true);
    expect(toggleGoalWidgetExpanded()).toBe(false);
  });
});
