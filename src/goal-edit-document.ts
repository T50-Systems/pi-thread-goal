import type { GoalState } from "./types.js";

export interface ParsedGoalEditDocument {
	objective: string;
	acceptanceCriteria: string[];
	sourcePaths: string[];
	tokenBudget?: number;
}

export function renderGoalEditDocument(goal: GoalState): string {
	return [
		"Objective:",
		goal.objective,
		"",
		"Acceptance criteria:",
		...formatEditableList(goal.acceptanceCriteria),
		"",
		"Source paths:",
		...formatEditableList(goal.sourcePaths),
		"",
		"Token budget:",
		goal.tokenBudget ? String(goal.tokenBudget) : "",
	].join("\n");
}

export function parseGoalEditDocument(value: string): ParsedGoalEditDocument {
	const sections = splitGoalEditSections(value);
	if (sections.size === 0) {
		return { objective: value.trim(), acceptanceCriteria: [], sourcePaths: [] };
	}

	const tokenBudget = parseTokenBudgetValue(
		(sections.get("token budget") ?? []).join(" ").trim(),
	);
	return {
		objective: (sections.get("objective") ?? []).join("\n").trim(),
		acceptanceCriteria: parseEditableList(
			sections.get("acceptance criteria") ?? [],
		),
		sourcePaths: parseEditableList(sections.get("source paths") ?? []),
		...(tokenBudget === undefined ? {} : { tokenBudget }),
	};
}

export function parseTokenBudgetValue(
	value: string | undefined,
): number | undefined {
	const normalized = value?.trim().toLowerCase().replace(/[,_]/g, "");
	if (!normalized) return undefined;
	const match = normalized.match(/^(\d+(?:\.\d+)?)([km])?$/);
	if (!match) return undefined;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount) || amount <= 0) return undefined;
	let multiplier = 1;
	if (match[2] === "m") multiplier = 1_000_000;
	if (match[2] === "k") multiplier = 1_000;
	return Math.floor(amount * multiplier);
}

function splitGoalEditSections(value: string): Map<string, string[]> {
	const sections = new Map<string, string[]>();
	let current: string | undefined;

	for (const rawLine of value.split(/\r?\n/)) {
		const header = rawLine
			.trim()
			.match(/^(Objective|Acceptance criteria|Source paths|Token budget):$/i);
		if (header) {
			current = header[1].toLowerCase();
			sections.set(current, []);
			continue;
		}
		if (current) sections.get(current)?.push(rawLine);
	}

	return sections;
}

function formatEditableList(values: string[]): string[] {
	return values.length > 0 ? values.map((value) => `- ${value}`) : ["- "];
}

function parseEditableList(lines: string[]): string[] {
	return [
		...new Set(
			lines.map((line) => line.trim().replace(/^[-*]\s*/, "")).filter(Boolean),
		),
	];
}
