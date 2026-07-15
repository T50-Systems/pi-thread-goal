#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const COMPATIBILITY_SETS = {
	minimum: {
		piCodingAgent: "0.74.2",
		piAi: "0.74.2",
		typebox: "1.1.24",
	},
	current: {
		piCodingAgent: "0.80.7",
		piAi: "0.80.7",
		typebox: "1.1.38",
	},
};
const EXPECTED_PEER_RANGES = {
	"@earendil-works/pi-ai": ">=0.74.2 <=0.80.7",
	"@earendil-works/pi-coding-agent": ">=0.74.2 <=0.80.7",
	typebox: ">=1.1.24 <=1.1.38",
};

const ALLOWED_ROOT_FILES = new Set([
	"CHANGELOG.md",
	"LICENSE",
	"README.md",
	"SECURITY.md",
	"package.json",
]);
const REQUIRED_RUNTIME_FILES = new Set([
	"extensions/index.ts",
	"src/index.ts",
	"src/tools.ts",
]);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
		...options,
	});
	if (result.error || result.status !== 0) {
		throw new Error(
			[
				`Command failed: ${command} ${args.join(" ")}`,
				result.error?.message,
				result.stdout,
				result.stderr,
			]
				.filter(Boolean)
				.join("\n"),
		);
	}
	return result.stdout.trim();
}

function runNpm(args, options = {}) {
	if (process.env.npm_execpath) {
		return run(process.execPath, [process.env.npm_execpath, ...args], options);
	}
	return run(npmCommand, args, {
		...options,
		shell: process.platform === "win32",
	});
}

function inspectPack(pack) {
	assert.equal(
		pack.bundled?.length ?? 0,
		0,
		"tarball must not bundle dependencies",
	);
	const paths = new Set();
	for (const file of pack.files ?? []) {
		const allowed =
			ALLOWED_ROOT_FILES.has(file.path) ||
			file.path === "extensions/index.ts" ||
			/^src\/[^/]+\.ts$/.test(file.path);
		assert.ok(allowed, `tarball contains non-allowlisted path: ${file.path}`);
		assert.equal(file.mode, 0o644, `unexpected packed mode for ${file.path}`);
		paths.add(file.path);
	}
	for (const required of REQUIRED_RUNTIME_FILES) {
		assert.ok(
			paths.has(required),
			`tarball is missing required runtime file: ${required}`,
		);
	}
}

async function readJson(file) {
	return JSON.parse(await readFile(file, "utf8"));
}

async function verifyDeclaredRuntimeImports(packageRoot) {
	const manifest = await readJson(path.join(packageRoot, "package.json"));
	const declared = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.optionalDependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	]);
	for (const directory of ["extensions", "src"]) {
		const root = path.join(packageRoot, directory);
		const entries = await readdir(root, { recursive: true });
		for (const entry of entries.filter((file) => file.endsWith(".ts"))) {
			const source = await readFile(path.join(root, entry), "utf8");
			const imports = source.matchAll(
				/\b(?:from\s+|import\s*)["']([^"']+)["']/g,
			);
			for (const match of imports) {
				const specifier = match[1];
				if (specifier.startsWith(".") || specifier.startsWith("node:"))
					continue;
				const parts = specifier.split("/");
				const packageName = specifier.startsWith("@")
					? parts.slice(0, 2).join("/")
					: parts[0];
				assert.ok(
					declared.has(packageName),
					`runtime import '${specifier}' is not declared by the packed package`,
				);
			}
		}
	}
}

async function verifyInstalledVersions(consumerDir, expected) {
	const versions = {
		piCodingAgent: (
			await readJson(
				path.join(
					consumerDir,
					"node_modules",
					"@earendil-works",
					"pi-coding-agent",
					"package.json",
				),
			)
		).version,
		piAi: (
			await readJson(
				path.join(
					consumerDir,
					"node_modules",
					"@earendil-works",
					"pi-ai",
					"package.json",
				),
			)
		).version,
		typebox: (
			await readJson(
				path.join(consumerDir, "node_modules", "typebox", "package.json"),
			)
		).version,
	};
	const extensionManifest = await readJson(
		path.join(consumerDir, "node_modules", "pi-thread-goal", "package.json"),
	);
	assert.deepEqual(
		extensionManifest.peerDependencies,
		EXPECTED_PEER_RANGES,
		"packed peer ranges must match the tested compatibility policy",
	);
	assert.deepEqual(
		versions,
		expected,
		"fresh consumer did not install the exact matrix set",
	);
	return versions;
}

async function exerciseInstalledExtension(consumerDir) {
	const codingAgentRoot = path.join(
		consumerDir,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	const codingPackage = await readJson(
		path.join(codingAgentRoot, "package.json"),
	);
	const codingEntry = path.join(
		codingAgentRoot,
		codingPackage.main ?? "dist/index.js",
	);
	const { discoverAndLoadExtensions, SessionManager } = await import(
		pathToFileURL(codingEntry)
	);
	assert.equal(typeof discoverAndLoadExtensions, "function");
	assert.equal(typeof SessionManager?.inMemory, "function");

	const packageRoot = path.join(consumerDir, "node_modules", "pi-thread-goal");
	await verifyDeclaredRuntimeImports(packageRoot);
	const agentDir = path.join(consumerDir, ".empty-agent");
	await mkdir(agentDir, { recursive: true });
	const loaded = await discoverAndLoadExtensions(
		[packageRoot],
		consumerDir,
		agentDir,
	);
	assert.deepEqual(
		loaded.errors,
		[],
		"installed extension must load without errors",
	);
	assert.equal(loaded.extensions.length, 1, "exactly one extension must load");

	const extension = loaded.extensions[0];
	assert.ok(
		path.resolve(extension.resolvedPath).startsWith(path.resolve(packageRoot)),
		"extension must load from the fresh consumer installation",
	);
	assert.ok(extension.commands.has("goal"), "/goal must be registered");
	for (const name of [
		"get_goal",
		"update_goal_progress",
		"prepare_goal_completion",
		"complete_goal",
	]) {
		assert.ok(extension.tools.has(name), `${name} must be registered`);
	}

	const sessionManager = SessionManager.inMemory(consumerDir);
	if (!sessionManager.getSessionId?.() && sessionManager.newSession) {
		sessionManager.newSession();
	}
	const sentMessages = [];
	Object.assign(loaded.runtime, {
		appendEntry: (customType, data) =>
			sessionManager.appendCustomEntry(customType, data),
		sendUserMessage: (prompt) => sentMessages.push(prompt),
		sendMessage: () => {},
		setSessionName: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: () => {},
		refreshTools: () => {},
		getCommands: () => [],
		setModel: async () => false,
		getThinkingLevel: () => "off",
		setThinkingLevel: () => {},
	});

	let providerAccesses = 0;
	const ctx = {
		hasUI: false,
		mode: "print",
		cwd: consumerDir,
		isIdle: () => true,
		isProjectTrusted: () => true,
		hasPendingMessages: () => false,
		waitForIdle: async () => {},
		sessionManager,
		modelRegistry: {
			find: () => {
				providerAccesses += 1;
				return undefined;
			},
			getApiKeyAndHeaders: async () => {
				providerAccesses += 1;
				return { ok: false };
			},
		},
		signal: undefined,
		ui: {
			notify: () => {},
			confirm: async () => true,
			editor: async () => undefined,
			setStatus: () => {},
			setWidget: () => {},
			select: async () => undefined,
			input: async () => undefined,
			custom: async () => undefined,
		},
	};

	await extension.commands
		.get("goal")
		.handler("verify packed compatibility", ctx);
	assert.ok(sentMessages.length > 0, "/goal must create and start the goal");

	const runTool = (name, params) => {
		const registered = extension.tools.get(name);
		assert.ok(registered, `tool not registered: ${name}`);
		return registered.definition.execute(
			name,
			params,
			undefined,
			undefined,
			ctx,
		);
	};
	const advanceLeaf = () =>
		sessionManager.appendCustomEntry("packed-compatibility-turn", {
			marker: "tool-result",
		});

	const observed = await runTool("get_goal", {});
	assert.equal(observed.details.goal.status, "active");
	advanceLeaf();
	const progressed = await runTool("update_goal_progress", {
		done: ["Packed extension loaded"],
		current: "Complete compatibility smoke",
		summary: "Provider-free SessionManager flow is running.",
	});
	assert.deepEqual(progressed.details.goal.progress.done, [
		"Packed extension loaded",
	]);
	advanceLeaf();
	await runTool("get_goal", {});
	advanceLeaf();
	const evidence =
		"Packed extension loaded and create/observe/progress flow completed with the real SessionManager.";
	await runTool("prepare_goal_completion", { evidence });
	advanceLeaf();
	const completed = await runTool("complete_goal", { evidence });
	assert.equal(completed.details.goal.status, "complete");
	assert.equal(completed.details.requiresFinalResponse, true);
	assert.equal(
		providerAccesses,
		0,
		"compatibility smoke must not access a provider",
	);
}

async function verifySet(root, tarball, label, versions) {
	const consumerDir = path.join(root, `consumer-${label}`);
	await mkdir(consumerDir, { recursive: true });
	await writeFile(
		path.join(consumerDir, "package.json"),
		`${JSON.stringify({ name: `packed-${label}`, private: true, type: "module" }, null, 2)}\n`,
	);
	runNpm(
		[
			"install",
			"--save-exact",
			"--no-audit",
			"--no-fund",
			`@earendil-works/pi-coding-agent@${versions.piCodingAgent}`,
			`@earendil-works/pi-ai@${versions.piAi}`,
			`typebox@${versions.typebox}`,
			tarball,
		],
		{ cwd: consumerDir },
	);
	await verifyInstalledVersions(consumerDir, versions);
	run(
		process.execPath,
		[fileURLToPath(import.meta.url), "--consumer", consumerDir],
		{ cwd: consumerDir },
	);
	console.log(
		`Packed compatibility ${label} passed: coding-agent ${versions.piCodingAgent}, pi-ai ${versions.piAi}, typebox ${versions.typebox}.`,
	);
}

async function main() {
	const setIndex = process.argv.indexOf("--set");
	const requested = setIndex >= 0 ? process.argv[setIndex + 1] : undefined;
	if (requested && !Object.hasOwn(COMPATIBILITY_SETS, requested)) {
		throw new Error(
			`Unknown compatibility set '${requested}'. Expected minimum or current.`,
		);
	}
	const selected = requested
		? [[requested, COMPATIBILITY_SETS[requested]]]
		: Object.entries(COMPATIBILITY_SETS);
	const root = await mkdtemp(path.join(tmpdir(), "pi-thread-goal-pack-"));
	try {
		const output = runNpm(["pack", "--json", "--pack-destination", root], {
			cwd: process.cwd(),
		});
		const packs = JSON.parse(output);
		assert.equal(packs.length, 1, "npm pack must produce exactly one tarball");
		inspectPack(packs[0]);
		const tarball = path.join(root, packs[0].filename);
		for (const [label, versions] of selected) {
			await verifySet(root, tarball, label, versions);
		}
	} finally {
		await rm(root, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
}

const action =
	process.argv[2] === "--consumer"
		? exerciseInstalledExtension(process.argv[3])
		: main();

action.catch((error) => {
	console.error(error instanceof Error ? error.stack : error);
	process.exitCode = 1;
});
