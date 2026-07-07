import { describe, expect, it } from "vitest";

import {
	authorizeGoalCompletion,
	authorizeProgressUpdate,
	observeGoal,
	prepareGoalCompletion,
} from "../src/goal-protocol-policy.js";
import { GoalProtocolCapabilityRegistry } from "../src/goal-protocol-tokens.js";
import type { GoalProtocolContext } from "../src/goal-protocol-context.js";
import type { GoalState } from "../src/types.js";

const contextA: GoalProtocolContext = {
	sessionId: "s1",
	branchId: "b1",
	actorId: "agent",
};
const contextB: GoalProtocolContext = {
	sessionId: "s2",
	branchId: "b1",
	actorId: "agent",
};

const goal: GoalState = {
	version: 1,
	revision: 1,
	goalId: "g1",
	objective: "ship",
	status: "active",
	acceptanceCriteria: [],
	sourcePaths: [],
	progress: { done: [], blocked: [], summary: "done" },
	createdAt: 1,
	updatedAt: 1,
	runStartedAt: 1,
	evaluationTurns: 0,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	lastEvaluationReason: "started",
};

describe("goal protocol policy", () => {
	it("denies complete_goal before a completion candidate exists", () => {
		const decision = authorizeGoalCompletion({
			context: contextA,
			goal,
			evidence: "done",
			registry: new GoalProtocolCapabilityRegistry(),
		});

		expect(decision.allowed).toBe(false);
		if (!decision.allowed) {
			expect(decision.code).toBe("require-completion-candidate");
			expect(decision.reason).toContain("prepare_goal_completion");
		}
	});

	it("requires an observation capability for progress updates", () => {
		const decision = authorizeProgressUpdate({
			context: contextA,
			goal,
			registry: new GoalProtocolCapabilityRegistry(),
		});

		expect(decision.allowed).toBe(false);
		if (!decision.allowed) expect(decision.code).toBe("require-observation");
	});

	it("allows the formal observe -> prepare -> complete flow", () => {
		const registry = new GoalProtocolCapabilityRegistry();
		const observed = observeGoal({
			context: contextA,
			goal,
			registry,
			now: 1_000,
		});
		expect(observed.allowed).toBe(true);
		if (!observed.allowed) throw new Error("expected observation");

		const prepared = prepareGoalCompletion({
			context: contextA,
			goal,
			evidence: "done",
			registry,
			now: 1_100,
		});
		expect(prepared.allowed).toBe(true);
		if (!prepared.allowed) throw new Error("expected completion candidate");

		const authorized = authorizeGoalCompletion({
			context: contextA,
			goal,
			evidence: "done",
			registry,
			now: 1_200,
		});

		expect(authorized.allowed).toBe(true);
		if (authorized.allowed)
			expect(authorized.output).toBe("execute-complete-goal");
	});

	it("denies capabilities across explicit contexts", () => {
		const registry = new GoalProtocolCapabilityRegistry();
		observeGoal({ context: contextA, goal, registry, now: 1_000 });

		const decision = authorizeProgressUpdate({
			context: contextB,
			goal,
			registry,
			now: 1_100,
		});

		expect(decision.allowed).toBe(false);
		if (!decision.allowed) expect(decision.code).toBe("require-observation");
	});

	it("resetGoalProtocolEpoch invalidates only the selected context", () => {
		const registry = new GoalProtocolCapabilityRegistry();
		observeGoal({ context: contextA, goal, registry, now: 1_000 });
		observeGoal({ context: contextB, goal, registry, now: 1_000 });

		registry.resetEpoch(contextA);

		const denied = authorizeProgressUpdate({
			context: contextA,
			goal,
			registry,
			now: 1_100,
		});
		const allowed = authorizeProgressUpdate({
			context: contextB,
			goal,
			registry,
			now: 1_100,
		});

		expect(denied.allowed).toBe(false);
		expect(allowed.allowed).toBe(true);
	});

	it("rejects expired capabilities", () => {
		const registry = new GoalProtocolCapabilityRegistry();
		observeGoal({ context: contextA, goal, registry, now: 1_000 });

		const decision = authorizeProgressUpdate({
			context: contextA,
			goal,
			registry,
			now: 1_000 + 5 * 60_000 + 1,
		});

		expect(decision.allowed).toBe(false);
		if (!decision.allowed) expect(decision.code).toBe("require-observation");
	});

	it("rejects stale observation and completion candidates after revision drift", () => {
		const registry = new GoalProtocolCapabilityRegistry();
		const observed = observeGoal({
			context: contextA,
			goal,
			registry,
			now: 1_000,
		});
		if (!observed.allowed) throw new Error("expected observation");
		const prepared = prepareGoalCompletion({
			context: contextA,
			goal,
			evidence: "done",
			registry,
			now: 1_100,
		});
		if (!prepared.allowed) throw new Error("expected completion candidate");
		const changed = { ...goal, revision: 2 };

		const progress = authorizeProgressUpdate({
			context: contextA,
			goal: changed,
			registry,
			now: 1_200,
		});
		const completion = authorizeGoalCompletion({
			context: contextA,
			goal: changed,
			evidence: "done",
			registry,
			now: 1_200,
		});

		expect(progress.allowed).toBe(false);
		if (!progress.allowed) expect(progress.code).toBe("stale-observation");
		expect(completion.allowed).toBe(false);
		if (!completion.allowed)
			expect(completion.code).toBe("stale-completion-candidate");
	});

	it("invalidates completion candidates when the goal mutates", () => {
		const registry = new GoalProtocolCapabilityRegistry();
		observeGoal({ context: contextA, goal, registry, now: 1_000 });
		const prepared = prepareGoalCompletion({
			context: contextA,
			goal,
			evidence: "done",
			registry,
			now: 1_100,
		});
		if (!prepared.allowed) throw new Error("expected completion candidate");

		registry.invalidateGoal(goal.goalId);

		const authorized = authorizeGoalCompletion({
			context: contextA,
			goal,
			evidence: "done",
			registry,
			now: 1_200,
		});

		expect(authorized.allowed).toBe(false);
		if (!authorized.allowed)
			expect(authorized.code).toBe("require-completion-candidate");
	});

	it("requires completion evidence to match the prepared candidate", () => {
		const registry = new GoalProtocolCapabilityRegistry();
		observeGoal({ context: contextA, goal, registry, now: 1_000 });
		const prepared = prepareGoalCompletion({
			context: contextA,
			goal,
			evidence: "done",
			registry,
			now: 1_100,
		});
		if (!prepared.allowed) throw new Error("expected completion candidate");

		const authorized = authorizeGoalCompletion({
			context: contextA,
			goal,
			evidence: "different evidence",
			registry,
			now: 1_200,
		});

		expect(authorized.allowed).toBe(false);
		if (!authorized.allowed)
			expect(authorized.code).toBe("stale-completion-candidate");
	});
	it("replaces older completion candidates in the same context", () => {
		const registry = new GoalProtocolCapabilityRegistry();
		observeGoal({ context: contextA, goal, registry, now: 1_000 });
		const first = prepareGoalCompletion({
			context: contextA,
			goal,
			evidence: "done",
			registry,
			now: 1_100,
		});
		expect(first.allowed).toBe(true);
		const second = prepareGoalCompletion({
			context: contextA,
			goal,
			evidence: "done again",
			registry,
			now: 1_200,
		});
		expect(second.allowed).toBe(true);

		const oldEvidence = authorizeGoalCompletion({
			context: contextA,
			goal,
			evidence: "done",
			registry,
			now: 1_300,
		});
		const newEvidence = authorizeGoalCompletion({
			context: contextA,
			goal,
			evidence: "done again",
			registry,
			now: 1_300,
		});

		expect(oldEvidence.allowed).toBe(false);
		expect(newEvidence.allowed).toBe(true);
	});
});
