#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLinter } from "actionlint";
import { isScalar, LineCounter, parseDocument, visit } from "yaml";

const REMOTE_ACTION_PATTERN = /^[^\s/@]+\/[^\s@]+@[0-9a-f]{40}$/;
const VERSION_COMMENT_PATTERN =
	/#\s*v\d+(?:\.\d+){1,2}(?:[-+][0-9A-Za-z.-]+)?\s*$/;
const BASH_SHELL_PATTERN = /^(?:bash|sh)(?:\s|$)/;

let actionlintPromise;

function relative(file) {
	return path.relative(process.cwd(), file).replaceAll("\\", "/");
}

function getActionlint() {
	actionlintPromise ??= createLinter();
	return actionlintPromise;
}

function formatParserIssue(file, issue) {
	const location = issue.linePos?.[0] ?? { line: 1, col: 1 };
	return `${relative(file)}:${location.line}:${location.col} ${issue.message}`;
}

function validateActionPins(file, source, document, lineCounter) {
	const errors = [];
	const lines = source.split(/\r?\n/);
	visit(document, {
		Pair(_key, pair) {
			if (!isScalar(pair.key) || pair.key.value !== "uses") return;
			const offset = pair.value?.range?.[0] ?? pair.key.range?.[0] ?? 0;
			const location = lineCounter.linePos(offset);
			if (!isScalar(pair.value) || typeof pair.value.value !== "string") {
				errors.push(
					`${relative(file)}:${location.line}:${location.col} uses must be a scalar action reference`,
				);
				return;
			}

			const reference = pair.value.value;
			if (reference.startsWith("./")) return;
			if (!REMOTE_ACTION_PATTERN.test(reference)) {
				errors.push(
					`${relative(file)}:${location.line}:${location.col} remote action '${reference}' must use a full lowercase 40-character commit SHA`,
				);
				return;
			}

			const sourceLine = lines[location.line - 1] ?? "";
			if (!VERSION_COMMENT_PATTERN.test(sourceLine)) {
				errors.push(
					`${relative(file)}:${location.line}:${location.col} pinned action '${reference}' must end with a release-version comment such as '# v5.0.1'`,
				);
			}
		},
	});
	return errors;
}

function shellErrorLine(stderr) {
	const match = /(?:line\s+)(\d+)/i.exec(stderr);
	return match ? Number(match[1]) : 1;
}

function defaultShell(owner) {
	const defaults = owner?.get?.("defaults", true);
	const run = defaults?.get?.("run", true);
	const shell = run?.get?.("shell", true);
	return isScalar(shell) ? String(shell.value) : undefined;
}

function resolveShell(step, parents) {
	const directShell = step?.get?.("shell", true);
	if (isScalar(directShell)) return String(directShell.value);

	const maps = parents.filter((node) => typeof node?.get === "function");
	const job = maps.findLast(
		(node) => node !== step && node.get("steps", true) !== undefined,
	);
	const jobShell = defaultShell(job);
	if (jobShell) return jobShell;

	const workflow = maps.find((node) => node.get("jobs", true) !== undefined);
	return defaultShell(workflow) ?? "bash";
}

function validateShellSyntax(file, document, lineCounter) {
	const errors = [];
	visit(document, {
		Pair(_key, pair, parents) {
			if (!isScalar(pair.key) || pair.key.value !== "run") return;
			const offset = pair.value?.range?.[0] ?? pair.key.range?.[0] ?? 0;
			const location = lineCounter.linePos(offset);
			if (!isScalar(pair.value) || typeof pair.value.value !== "string") {
				errors.push(
					`${relative(file)}:${location.line}:${location.col} run must contain a scalar shell script`,
				);
				return;
			}

			const step = parents.at(-1);
			const shell = resolveShell(step, parents);
			if (!BASH_SHELL_PATTERN.test(shell)) {
				errors.push(
					`${relative(file)}:${location.line}:${location.col} shell '${shell}' is not covered by the offline Bash syntax validator`,
				);
				return;
			}

			const result = spawnSync("bash", ["-n"], {
				encoding: "utf8",
				input: pair.value.value,
				windowsHide: true,
			});
			if (result.error) {
				errors.push(
					`${relative(file)}:${location.line}:${location.col} Bash syntax validation could not run: ${result.error.message}`,
				);
				return;
			}
			if (result.status !== 0) {
				const scriptLine = shellErrorLine(result.stderr);
				const workflowLine = location.line + scriptLine - 1;
				errors.push(
					`${relative(file)}:${workflowLine}:${location.col} invalid Bash syntax: ${result.stderr.trim()}`,
				);
			}
		},
	});
	return errors;
}

function isSupportedGithubContextGap(result) {
	return (
		result.kind === "expression" &&
		result.message.startsWith('undefined variable "vars".')
	);
}

export async function validateWorkflowFile(file) {
	const source = await readFile(file, "utf8");
	const actionlint = await getActionlint();
	const errors = actionlint(source, relative(file))
		.filter((result) => !isSupportedGithubContextGap(result))
		.map(
			(result) =>
				`${result.file}:${result.line}:${result.column} [${result.kind}] ${result.message}`,
		);

	const lineCounter = new LineCounter();
	const document = parseDocument(source, {
		lineCounter,
		prettyErrors: true,
		uniqueKeys: true,
	});
	const parserIssues = [...document.errors, ...document.warnings];
	if (parserIssues.length > 0) {
		errors.push(...parserIssues.map((issue) => formatParserIssue(file, issue)));
		return [...new Set(errors)];
	}

	errors.push(...validateActionPins(file, source, document, lineCounter));
	errors.push(...validateShellSyntax(file, document, lineCounter));
	return [...new Set(errors)];
}

export async function discoverWorkflowFiles(root = process.cwd()) {
	const directory = path.join(root, ".github", "workflows");
	const entries = await readdir(directory, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
		.map((entry) => path.join(directory, entry.name))
		.sort((left, right) => left.localeCompare(right));
}

export async function validateWorkflows(root = process.cwd()) {
	const files = await discoverWorkflowFiles(root);
	const results = await Promise.all(
		files.map(async (file) => ({
			errors: await validateWorkflowFile(file),
			file,
		})),
	);
	return {
		errors: results.flatMap((result) => result.errors),
		files,
	};
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
	try {
		const result = await validateWorkflows();
		if (result.errors.length > 0) {
			for (const error of result.errors) console.error(error);
			process.exitCode = 1;
		} else {
			console.log(
				`Workflow semantics, expressions, shell syntax, and immutable-action validation passed (${result.files.length} files).`,
			);
		}
	} catch (error) {
		console.error(
			`Workflow validation failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
