import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Layer 2 verification: drive a REAL Pi session with a REAL model end-to-end.
// This is the highest-fidelity check — it exercises the actual host runtime,
// the model, and the full tool loop — but it needs a configured provider and
// makes billable model calls, so it is opt-in.
//
// Run it before cutting a release:
//   PI_E2E=1 npm run test:e2e-pi
//
// It is skipped by default (in `npm test` and CI) so the normal suite stays
// fast, deterministic, and offline.

const LIVE = process.env.PI_E2E === "1";

// Deterministic, low-ambiguity instructions so the model reliably drives the
// full protocol handshake. The goal work itself is trivial on purpose.
const PROMPT = [
	"Use your goal tools now, in order, and do nothing else:",
	'1) create_goal with objective "compute 2+2 and report the result" and explicit_request true.',
	"2) get_goal.",
	"3) The answer is 4.",
	'4) prepare_goal_completion with evidence "2+2=4, verified".',
	'5) complete_goal with evidence "2+2=4, verified".',
	"Then stop.",
].join(" ");

function goalReachedComplete(sessionDir: string): {
	complete: boolean;
	statuses: string[];
} {
	const files = readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
	const statuses: string[] = [];
	let complete = false;
	for (const file of files) {
		const lines = readFileSync(join(sessionDir, file), "utf8")
			.split(/\r?\n/)
			.filter(Boolean);
		for (const line of lines) {
			let entry: {
				customType?: string;
				data?: { state?: { status?: string } };
			};
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (entry.customType !== "thread-goal-state") continue;
			const status = entry.data?.state?.status;
			if (typeof status === "string") statuses.push(status);
			if (status === "complete") complete = true;
		}
	}
	return { complete, statuses };
}

describe.skipIf(!LIVE)("live Pi session (real model)", () => {
	it(
		"creates and completes a goal end-to-end with no protocol errors",
		() => {
			const sessionDir = mkdtempSync(join(tmpdir(), "pi-goal-e2e-"));
			const ext = join(process.cwd(), "extensions", "index.ts");
			let output = "";
			try {
				// shell:true is needed to resolve the `pi` launcher across
				// platforms (e.g. pi.cmd on Windows). It is safe here: the args
				// are fixed flags plus paths we create, and the model prompt is
				// passed on stdin, never interpolated into the command line.
				const res = spawnSync(
					"pi",
					[
						"--print",
						"--no-extensions",
						"-e",
						ext,
						"--session-dir",
						sessionDir,
					],
					{
						input: PROMPT,
						encoding: "utf8",
						shell: true,
						timeout: 240_000,
					},
				);
				output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;

				// Regression guards: these are the exact failure signatures of the
				// two shipped bugs. They must never appear in a real session.
				expect(output).not.toMatch(/Extension error/i);
				expect(output).not.toMatch(/Goal protocol requires/i);
				expect(output).not.toMatch(/Call get_goal before mutating/i);

				// End-to-end success: the goal must actually reach completion.
				const { complete, statuses } = goalReachedComplete(sessionDir);
				expect(
					complete,
					`goal did not reach "complete"; observed statuses: ${JSON.stringify(
						statuses,
					)}. Output tail:\n${output.slice(-1500)}`,
				).toBe(true);
			} finally {
				rmSync(sessionDir, { recursive: true, force: true });
			}
		},
		300_000,
	);
});
