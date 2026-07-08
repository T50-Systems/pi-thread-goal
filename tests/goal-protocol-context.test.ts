import { describe, expect, it } from "vitest";
import { requireGoalProtocolContext } from "../src/goal-protocol.js";

describe("requireGoalProtocolContext", () => {
	it("derives the context from the Pi session manager", () => {
		const context = requireGoalProtocolContext({
			sessionManager: { sessionId: "session-1", leafId: "leaf-9" },
		});
		expect(context).toEqual({ sessionId: "session-1", branchId: "leaf-9" });
	});

	it("falls back to the session id for the branch when no leaf is set", () => {
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

	it("distinguishes branches within the same session by leaf", () => {
		const a = requireGoalProtocolContext({
			sessionManager: { sessionId: "s", leafId: "leaf-a" },
		});
		const b = requireGoalProtocolContext({
			sessionManager: { sessionId: "s", leafId: "leaf-b" },
		});
		expect(a.branchId).not.toBe(b.branchId);
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
