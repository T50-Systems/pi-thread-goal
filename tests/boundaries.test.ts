import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = join(process.cwd(), "src");

function readSource(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function sourceFiles(dir = srcDir): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		if (path.endsWith(".ts")) return [path];
		return [];
	});
}

function relativeSourcePath(path: string): string {
	return path
		.replaceAll("\\", "/")
		.replace(process.cwd().replaceAll("\\", "/"), "");
}

describe("source boundaries", () => {
	it("keeps domain types free of runtime and Pi infrastructure contracts", () => {
		const source = readSource("src/types.ts");
		expect(source).not.toMatch(/RuntimeExtensionAPI/);
		expect(source).not.toMatch(/GoalRuntimeContext/);
		expect(source).not.toMatch(/sessionManager/);
		expect(source).not.toMatch(/modelRegistry/);
		expect(source).not.toMatch(/sendUserMessage/);
	});

	it("keeps the Pi AI compat import isolated in the evaluator module", () => {
		const matches = sourceFiles().flatMap((path) =>
			readFileSync(path, "utf8").includes("@earendil-works/pi-ai/compat")
				? [relativeSourcePath(path)]
				: [],
		);

		expect(matches).toEqual(["/src/evaluator.ts"]);
	});

	it("keeps policies independent from tool-facing modules", () => {
		const source = readSource("src/policies.ts");
		expect(source).not.toMatch(/from ["']\.\/tools\.js["']/);
	});

	it("keeps pure domain modules independent from adapters and runtime orchestration", () => {
		// Modules that are allowed to touch adapters, Pi infrastructure, or
		// runtime orchestration, and are covered by their own dedicated
		// boundary tests elsewhere in this file (or are the composition
		// root / Pi-facing registration surfaces). Everything else in src/
		// is assumed to be pure domain logic and is checked automatically,
		// so a new pure module cannot silently escape this check.
		const adapterOrRuntimeModules = new Set([
			"commands.ts",
			"continuation.ts",
			"evaluator.ts",
			"goal-operations.ts",
			"goal-state-persistence.ts",
			"index.ts",
			"pi-continuation-ports.ts",
			"runtime-actions.ts",
			"runtime-mode-handlers.ts",
			"runtime-types.ts",
			"runtime.ts",
			"tools.ts",
			"types.ts",
			"ui.ts",
		]);
		const pureModules = readdirSync(srcDir)
			.filter((entry) => entry.endsWith(".ts"))
			.filter((entry) => !adapterOrRuntimeModules.has(entry));

		expect(pureModules.length).toBeGreaterThan(0);
		for (const entry of pureModules) {
			const path = `src/${entry}`;
			const source = readSource(path);
			expect(source, path).not.toMatch(/adapter/i);
			expect(source, path).not.toMatch(/from ["']\.\/runtime\.js["']/);
			expect(source, path).not.toMatch(/@earendil-works/);
		}
	});

	it("keeps runtime as a hook registration composition root", () => {
		const source = readSource("src/runtime.ts");
		expect(source).toMatch(/handleBeforeAgentStart/);
		expect(source).toMatch(/handleAgentEndWithLock/);
		expect(source).not.toMatch(/function handleAgentEnd/);
		expect(source).not.toMatch(/saveGoalState/);
		expect(source).not.toMatch(/evaluateGoal/);
	});

	it("keeps continuation application logic free of Pi persistence/message adapters", () => {
		const source = readSource("src/continuation.ts");
		expect(source).not.toMatch(/saveGoalState/);
		expect(source).not.toMatch(/sendUserMessage/);
		expect(source).not.toMatch(/RuntimeExtensionAPI/);
	});

	it("keeps concrete Pi continuation code in the Pi continuation adapter", () => {
		const source = readSource("src/pi-continuation-ports.ts");
		expect(source).toMatch(/saveGoalOperation/);
		expect(source).toMatch(/sendUserMessage/);
	});
});
