import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	validateWorkflowFile,
	validateWorkflows,
} from "../scripts/validate-workflows.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const fixtures = path.join(import.meta.dirname, "fixtures", "workflows");

describe("workflow validation", () => {
	it("accepts every checked-in workflow", async () => {
		const result = await validateWorkflows(repositoryRoot);

		expect(result.files.map((file) => path.basename(file))).toEqual([
			"ci.yml",
			"release.yml",
		]);
		expect(result.errors).toEqual([]);
	});

	it("rejects invalid workflow semantics", async () => {
		const errors = await validateWorkflowFile(
			path.join(fixtures, "invalid-semantic.yml"),
		);
		const output = errors.join("\n");

		expect(output).toContain("invalid-semantic.yml:4:3");
		expect(output).toContain('"runs-on" section is missing');
	});

	it("rejects mutable remote action references", async () => {
		const errors = await validateWorkflowFile(
			path.join(fixtures, "mutable-action.yml"),
		);

		expect(errors.join("\n")).toContain(
			"remote action 'actions/checkout@v5' must use a full lowercase 40-character commit SHA",
		);
	});

	it("requires a human-readable version comment for each pin", async () => {
		const errors = await validateWorkflowFile(
			path.join(fixtures, "missing-version-comment.yml"),
		);

		expect(errors.join("\n")).toContain(
			"must end with a release-version comment such as '# v5.0.1'",
		);
	});

	it("rejects malformed GitHub expressions", async () => {
		const errors = await validateWorkflowFile(
			path.join(fixtures, "invalid-expression.yml"),
		);
		const output = errors.join("\n");

		expect(output).toContain("invalid-expression.yml:7:31 [expression]");
		expect(output).toContain("unexpected end of input");
	});

	it("rejects invalid Bash syntax", async () => {
		const errors = await validateWorkflowFile(
			path.join(fixtures, "invalid-shell.yml"),
		);
		const output = errors.join("\n");

		expect(output).toContain("invalid-shell.yml:7:");
		expect(output).toContain("invalid Bash syntax");
	});

	it("fails closed for an inherited unsupported shell", async () => {
		const errors = await validateWorkflowFile(
			path.join(fixtures, "inherited-unsupported-shell.yml"),
		);
		const output = errors.join("\n");

		expect(output).toContain("inherited-unsupported-shell.yml:10:");
		expect(output).toContain(
			"shell 'pwsh' is not covered by the offline Bash syntax validator",
		);
	});
});
