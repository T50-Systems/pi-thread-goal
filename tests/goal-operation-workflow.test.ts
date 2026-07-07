import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	authorizeProgressUpdate,
	observeGoal,
} from "../src/goal-protocol-policy.js";
import { resetGoalProtocolEpoch } from "../src/goal-protocol-tokens.js";
import { executeGoalOperation } from "../src/goal-operation-workflow.js";
import { reduceGoalState } from "../src/state.js";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src");

describe("goal operation workflow adoption", () => {
	it("keeps direct saveGoalState usage inside the legacy store only", () => {
		const offenders = readdirSync(SRC_DIR)
			.filter((file) => file.endsWith(".ts") && file !== "goal-state-store.ts")
			.flatMap((file) => {
				const path = join(SRC_DIR, file);
				const text = readFileSync(path, "utf8");
				return text.includes("saveGoalState(") ? [file] : [];
			});

		expect(offenders).toEqual([]);
	});

	it("routes mutating runtime files through saveGoalOperation", () => {
		const files = [
			"commands.ts",
			"tools.ts",
			"runtime-actions.ts",
			"runtime-mode-handlers.ts",
			"pi-continuation-ports.ts",
		];

		for (const file of files) {
			const text = readFileSync(join(SRC_DIR, file), "utf8");
			expect(text, file).toContain("saveGoalOperation");
		}
	});
	it("invalidates capabilities for both replaced and replacement goal ids", () => {
		const context = { sessionId: "replace-session", branchId: "test-branch" };
		resetGoalProtocolEpoch(context);
		const before = reduceGoalState(null, {
			action: "create",
			goalId: "g1",
			objective: "old",
			now: 1,
		});
		if (!before) throw new Error("expected goal");
		const observed = observeGoal({ context, goal: before, now: 1_000 });
		if (!observed.allowed) throw new Error("expected observation");
		const appended: unknown[] = [];

		const result = executeGoalOperation({
			pi: { appendEntry: (_customType, data) => appended.push(data) },
			before,
			event: {
				action: "replace",
				goalId: "g2",
				objective: "new",
				now: 2,
				source: "user-command",
				explicitUserIntent: true,
				causedBy: "test",
			},
		});

		expect(result.ok).toBe(true);
		expect(appended).toHaveLength(1);
		const stale = authorizeProgressUpdate({
			context,
			goal: before,
			now: 1_100,
		});
		expect(stale.allowed).toBe(false);
		if (!stale.allowed) expect(stale.code).toBe("require-observation");
	});
});
