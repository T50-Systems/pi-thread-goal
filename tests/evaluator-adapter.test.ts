import { describe, expect, it, vi } from "vitest";
import { completeGoalEvaluation } from "../src/evaluator-adapter.js";

const completeMock = vi.fn();

vi.mock("@earendil-works/pi-ai/compat", () => ({
	complete: completeMock,
}));

describe("completeGoalEvaluation", () => {
	it("delegates to the Pi AI compat adapter with model, context, and options", async () => {
		const model = { provider: "anthropic", id: "claude-haiku-4-5" };
		const context = {
			systemPrompt: "evaluate",
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: "goal evidence" }],
					timestamp: 123,
				},
			],
		};
		const options = {
			apiKey: "key",
			headers: { "x-test": "1" },
			signal: new AbortController().signal,
		};
		const response = { content: [{ type: "text", text: '{"met":true}' }] };
		completeMock.mockResolvedValueOnce(response);

		await expect(
			completeGoalEvaluation(model as never, context, options),
		).resolves.toBe(response);

		expect(completeMock).toHaveBeenCalledTimes(1);
		expect(completeMock).toHaveBeenCalledWith(model, context, options);
	});

	it("propagates provider errors without wrapping them", async () => {
		const error = new Error("provider overload");
		completeMock.mockRejectedValueOnce(error);

		await expect(
			completeGoalEvaluation(
				{ provider: "anthropic", id: "claude-haiku-4-5" } as never,
				{ systemPrompt: "evaluate", messages: [] },
				{},
			),
		).rejects.toBe(error);
	});
});
