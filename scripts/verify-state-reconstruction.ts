import { performance } from "node:perf_hooks";
import process from "node:process";
import { makeGoalHistory } from "../benchmarks/state-reconstruction-fixture.js";
import { createGoalStateSnapshot } from "../src/goal-state-persistence.js";

const ENTRY_COUNT = 1_001;
const WARMUP_RUNS = 25;
const SAMPLE_RUNS = 100;
const DEFAULT_P99_BUDGET_MS = 50;
const budgetArgument = process.argv.find((argument) =>
	argument.startsWith("--budget-ms="),
);
const P99_BUDGET_MS = budgetArgument
	? Number(budgetArgument.slice("--budget-ms=".length))
	: DEFAULT_P99_BUDGET_MS;
if (!Number.isFinite(P99_BUDGET_MS) || P99_BUDGET_MS < 0) {
	throw new Error("--budget-ms must be a non-negative finite number.");
}

const history = makeGoalHistory(ENTRY_COUNT - 1);

for (let index = 0; index < WARMUP_RUNS; index += 1) {
	createGoalStateSnapshot(history);
}

const samples: number[] = [];
for (let index = 0; index < SAMPLE_RUNS; index += 1) {
	const startedAt = performance.now();
	const snapshot = createGoalStateSnapshot(history);
	samples.push(performance.now() - startedAt);
	if (snapshot.current?.revision !== ENTRY_COUNT) {
		throw new Error(
			`Replay fixture produced revision ${snapshot.current?.revision ?? "null"}; expected ${ENTRY_COUNT}.`,
		);
	}
}

samples.sort((left, right) => left - right);
const p99Index = Math.ceil(samples.length * 0.99) - 1;
const p99 = samples[p99Index] ?? Number.POSITIVE_INFINITY;
const mean =
	samples.reduce((total, sample) => total + sample, 0) / samples.length;
const summary = {
	fixtureEntries: ENTRY_COUNT,
	warmupRuns: WARMUP_RUNS,
	sampleRuns: SAMPLE_RUNS,
	meanMs: Number(mean.toFixed(4)),
	p99Ms: Number(p99.toFixed(4)),
	budgetMs: P99_BUDGET_MS,
	node: process.version,
	platform: `${process.platform}/${process.arch}`,
};

console.log(JSON.stringify(summary));
if (p99 > P99_BUDGET_MS) {
	console.error(
		`State reconstruction p99 ${p99.toFixed(4)} ms exceeded the ${P99_BUDGET_MS} ms CI budget.`,
	);
	process.exitCode = 1;
}
