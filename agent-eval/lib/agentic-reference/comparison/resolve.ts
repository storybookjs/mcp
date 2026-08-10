import { readdirSync } from 'node:fs';

import { AGENTIC_REF_CASES } from '../cases.ts';
import { AGENT_NAME_PARTS } from '../experiment.ts';

export interface ResolvedCase {
	caseName: string;
	experiment: string;
	shortName: string;
}

const EXPERIMENT_PREFIX = 'agentic-ref-';

/** cc-do-dont-opus-high -> do-dont, by stripping any agent's prefix/suffix pair. */
function shortNameOf(caseName: string): string {
	for (const { prefix, modelSuffix } of Object.values(AGENT_NAME_PARTS)) {
		const head = `${prefix}-`;
		const tail = `-${modelSuffix}`;
		if (caseName.startsWith(head) && caseName.endsWith(tail)) {
			return caseName.slice(head.length, -tail.length);
		}
	}
	return caseName;
}

function resolvedCases(): ResolvedCase[] {
	return AGENTIC_REF_CASES.map((c) => ({
		caseName: c.name,
		experiment: `${EXPERIMENT_PREFIX}${c.name}`,
		shortName: shortNameOf(c.name),
	}));
}

export function resolveCase(input: string): ResolvedCase {
	const matches = resolvedCases().filter(
		(c) => c.shortName === input || c.caseName === input || c.experiment === input,
	);
	if (matches.length === 1) return matches[0]!;
	const known = resolvedCases()
		.map((c) => c.shortName)
		.sort()
		.join(', ');
	if (matches.length === 0) throw new Error(`Unknown case "${input}". Known cases: ${known}`);
	throw new Error(
		`Ambiguous case "${input}": matches ${matches.map((c) => c.caseName).join(', ')}`,
	);
}

export function resolveTreatments(
	input: string | undefined,
	control: ResolvedCase,
	experimentsWithData: string[],
): ResolvedCase[] {
	if (input === undefined || input === 'all') {
		return resolvedCases()
			.filter((c) => c.caseName !== control.caseName)
			.filter((c) => experimentsWithData.includes(c.experiment))
			.sort((a, b) => a.caseName.localeCompare(b.caseName));
	}
	const treatments = input.split(',').map((name) => resolveCase(name.trim()));
	if (treatments.some((c) => c.caseName === control.caseName)) {
		throw new Error(`The control case "${control.shortName}" cannot also be a treatment.`);
	}
	// Deduplicate by caseName, keeping first occurrence and preserving order
	const seen = new Set<string>();
	return treatments.filter((c) => {
		if (seen.has(c.caseName)) return false;
		seen.add(c.caseName);
		return true;
	});
}

export function knownWorkflows(evalsDir: string): string[] {
	return readdirSync(evalsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && /^7\d\d-/.test(entry.name))
		.map((entry) => entry.name)
		.sort();
}

export function resolveWorkflows(input: string | undefined, known: string[]): string[] | null {
	if (input === undefined) return null;
	if (input === 'all') return [...known];
	const resolved = input.split(',').map((raw) => {
		const name = raw.trim();
		const matches = known.filter((w) => w === name || w.startsWith(`${name}-`));
		if (matches.length === 1) return matches[0]!;
		throw new Error(
			matches.length === 0
				? `Unknown workflow "${name}". Known workflows: ${known.join(', ')}`
				: `Ambiguous workflow "${name}": matches ${matches.join(', ')}`,
		);
	});
	return [...new Set(resolved)].sort();
}

/** Deterministic output-directory slug for a comparison. */
export function comparisonSlug(
	control: ResolvedCase,
	treatments: ResolvedCase[],
	workflows: string[],
): string {
	const t = treatments
		.map((c) => c.shortName)
		.sort()
		.join('+');
	const w = workflows
		.map((name) => name.split('-')[0]!)
		.sort()
		.join('+');
	return `${control.shortName}_vs_${t}@${w}`;
}
