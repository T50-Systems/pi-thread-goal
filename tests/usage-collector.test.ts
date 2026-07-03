import { describe, expect, it } from "vitest";
import { collectUsage } from "../src/usage-collector.js";

describe("collectUsage", () => {
	it("sums assistant usage and ignores non-assistant messages", () => {
		expect(
			collectUsage([
				{ role: "user", usage: { input: 100, output: 100, total: 200 } },
				{ role: "assistant", usage: { input: 2, output: 3, total: 8 } },
				{
					role: "assistant",
					usage: { input: 5, output: 7, cacheRead: 11, cacheWrite: 13 },
				},
			]),
		).toEqual({
			input: 7,
			output: 10,
			cacheRead: 11,
			cacheWrite: 13,
			total: 20,
		});
	});

	it("uses totalTokens when total is absent", () => {
		expect(
			collectUsage([
				{ role: "assistant", usage: { input: 2, output: 3, totalTokens: 9 } },
			]),
		).toMatchObject({ total: 9 });
	});
});
