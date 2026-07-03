import type { GoalState } from "./types.js";

export function visibleWidth(value: string): number {
	return stripAnsi(value).length;
}

export function truncateToVisibleWidth(value: string, width: number): string {
	const plain = stripAnsi(value);
	return plain.length <= width ? value : plain.slice(0, Math.max(0, width));
}

export function wrapPlainText(value: string, width: number): string[] {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (!normalized) return [""];
	if (width <= 1) return normalized.split("").slice(0, 200);

	const words = normalized.split(" ");
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		if (!current) {
			current = word;
			continue;
		}
		if (`${current} ${word}`.length <= width) {
			current = `${current} ${word}`;
			continue;
		}
		lines.push(current);
		if (word.length <= width) {
			current = word;
			continue;
		}
		const chunks = chunkText(word, width);
		lines.push(...chunks.slice(0, -1));
		current = chunks.at(-1) ?? "";
	}

	if (current) lines.push(current);
	return lines;
}

export function summarizeList(values: string[]): string {
	if (values.length <= 2) return values.join("; ");
	return `${values[0]}; ${values[1]}; +${values.length - 2} more`;
}

export function formatElapsedTime(startedAt: number, now = Date.now()): string {
	const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
	const days = Math.floor(totalSeconds / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	return [
		days > 0 ? `${days}d` : undefined,
		hours > 0 || days > 0 ? `${hours}h` : undefined,
		minutes > 0 || hours > 0 || days > 0 ? `${minutes}m` : undefined,
		`${seconds}s`,
	]
		.filter((part): part is string => Boolean(part))
		.join(" ");
}

export function truncate(value: string, max = 72): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length <= max
		? normalized
		: `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

export function formatTokenSpend(goal: GoalState): string {
	const used = formatCompactNumber(goal.usage.total);
	return goal.tokenBudget
		? `${used}/${formatCompactNumber(goal.tokenBudget)}`
		: used;
}

function chunkText(value: string, width: number): string[] {
	const chunks: string[] = [];
	for (let i = 0; i < value.length; i += width)
		chunks.push(value.slice(i, i + width));
	return chunks;
}

function stripAnsi(value: string): string {
	return value.replace(/\x1B\[[0-9;]*m/g, "");
}

function formatCompactNumber(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
}
