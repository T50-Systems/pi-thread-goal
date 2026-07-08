import { describe, expect, it } from "vitest";
import { requireGoalProtocolContext } from "../src/goal-protocol.js";

describe("requireGoalProtocolContext", () => {
	it("derives the context from the Pi session manager", () => {
		const context = requireGoalProtocolContext({
			sessionManager: { sessionId: "session-1", leafId: "leaf-9" },
		});
		expect(context).toEqual({ sessionId: "session-1", branchId: "session-1" });
	});

	it("derives a branch id that is stable regardless of the advancing leaf", () => {
		// The session leaf advances on every appended entry within a turn. The
		// get_goal -> prepare_goal_completion -> complete_goal handshake must keep
		// the same capability key across those calls, so branchId must not depend
		// on leafId.
		const atGetGoal = requireGoalProtocolContext({
			sessionManager: { sessionId: "s", leafId: "leaf-a" },
		});
		const atMutation = requireGoalProtocolContext({
			sessionManager: { sessionId: "s", leafId: "leaf-b" },
		});
		expect(atGetGoal.branchId).toBe(atMutation.branchId);
		expect(atGetGoal).toEqual(atMutation);
	});

	it("resolves a context even when no leaf is set", () => {
		expect(
			requireGoalProtocolContext({
				sessionManager: { sessionId: "session-1", leafId: null },
			}),
		).toEqual({ sessionId: "session-1", branchId: "session-1" });

		expect(
			requireGoalProtocolContext({
				sessionManager: { sessionId: "session-1" },
			}),
		).toEqual({ sessionId: "session-1", branchId: "session-1" });
	});

	it("prefers an explicit host-provided protocol context when present", () => {
		const context = requireGoalProtocolContext({
			goalProtocol: { sessionId: "explicit-s", branchId: "explicit-b" },
			sessionManager: { sessionId: "ignored", leafId: "ignored-leaf" },
		});
		expect(context).toEqual({
			sessionId: "explicit-s",
			branchId: "explicit-b",
		});
	});

	it("throws when no session id can be resolved", () => {
		expect(() => requireGoalProtocolContext({})).toThrow(/session id/i);
		expect(() =>
			requireGoalProtocolContext({ sessionManager: { sessionId: "  " } }),
		).toThrow(/session id/i);
	});

	it("rejects an explicit context with empty identifiers", () => {
		expect(() =>
			requireGoalProtocolContext({
				goalProtocol: { sessionId: "", branchId: "b" },
			}),
		).toThrow(/invalid/i);
	});
});
