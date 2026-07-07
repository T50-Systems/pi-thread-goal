import { type GoalUsage, isRecord } from "./types.js";

export function collectUsage(messages: unknown[]): Partial<GoalUsage> {
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	for (const message of messages) {
		if (!isAssistantUsageMessage(message)) continue;
		usage.input += numericField(message.usage, "input");
		usage.output += numericField(message.usage, "output");
		usage.cacheRead += numericField(message.usage, "cacheRead");
		usage.cacheWrite += numericField(message.usage, "cacheWrite");
		usage.total +=
			numericField(message.usage, "total") ||
			numericField(message.usage, "totalTokens") ||
			numericField(message.usage, "input") +
				numericField(message.usage, "output");
	}
	return usage;
}

function isAssistantUsageMessage(
	value: unknown,
): value is { role: "assistant"; usage: Record<string, unknown> } {
	if (!isRecord(value)) return false;
	return value.role === "assistant" && isRecord(value.usage);
}

function numericField(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
