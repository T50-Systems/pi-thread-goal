import { bench, describe } from "vitest";
import { createGoalStateSnapshot } from "../src/goal-state-persistence.js";
import { makeGoalHistory } from "./state-reconstruction-fixture.js";

const shortHistory = makeGoalHistory(25);
const longHistory = makeGoalHistory(1_000);

describe("goal state reconstruction", () => {
	bench("26 branch entries", () => {
		createGoalStateSnapshot(shortHistory);
	});

	bench("1,001 branch entries", () => {
		createGoalStateSnapshot(longHistory);
	});
});
