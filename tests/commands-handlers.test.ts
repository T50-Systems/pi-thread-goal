import { describe, expect, it, vi } from "vitest";
import { handleGoalCommand } from "../src/commands.js";

describe("handleGoalCommand", () => {
	it("handles clear command interactively", async () => {
		const pi = { appendEntry: vi.fn(), setContext: vi.fn(), updateWidget: vi.fn(), pushMessage: vi.fn(), hasSession: true, sessionContext: {} };
		const ui = { notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) };
		const ctx = { ui, isIdle: true, hasPendingMessages: false, hasUI: true, sessionManager: { getBranch: () => [] }, goalProtocol: {}, waitForIdle: vi.fn().mockResolvedValue(true) };
		
		await handleGoalCommand(pi as any, "clear", ctx as any);
		expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("No goal exists"), "warning");
	});

    it("handles complete command interactively", async () => {
		const pi = { appendEntry: vi.fn(), setContext: vi.fn(), updateWidget: vi.fn(), pushMessage: vi.fn(), hasSession: true, sessionContext: {} };
		const ui = { notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) };
		const ctx = { ui, isIdle: true, hasPendingMessages: false, hasUI: true, sessionManager: { getBranch: () => [] }, goalProtocol: {}, waitForIdle: vi.fn().mockResolvedValue(true) };
		
		await handleGoalCommand(pi as any, "complete", ctx as any);
		expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("No goal exists"), "warning");
	});

    it("handles dismiss command", async () => {
		const pi = { appendEntry: vi.fn(), setContext: vi.fn(), updateWidget: vi.fn(), pushMessage: vi.fn(), hasSession: true, sessionContext: {} };
		const ui = { notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) };
		const ctx = { ui, isIdle: true, hasPendingMessages: false, hasUI: true, sessionManager: { getBranch: () => [] }, goalProtocol: {}, waitForIdle: vi.fn().mockResolvedValue(true) };
		
		await handleGoalCommand(pi as any, "dismiss", ctx as any);
		expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("No goal exists"), "warning");
	});
});
