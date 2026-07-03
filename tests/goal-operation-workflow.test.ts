import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
			"goal-command-handlers.ts",
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
});
