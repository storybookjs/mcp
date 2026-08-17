import { describe, expect, it } from 'vitest';

import { JUDGE_OUTPUT_SCHEMA } from './types.ts';

// A validator for exactly the JSON Schema subset JUDGE_OUTPUT_SCHEMA uses:
// objects with `properties`/`required`/`additionalProperties: false`, arrays
// with `items`, `enum`, `anyOf`, and the four scalar types. Hand-written rather
// than pulled from a library because the point is to pin what *this* schema
// admits, and a transitive ajv is not a dependency this package declares.
//
// It is not a general validator and must not become one: if the schema grows a
// keyword this does not know, add it here deliberately.
function matches(schema: unknown, value: unknown): boolean {
	if (typeof schema !== 'object' || schema === null) return false;
	const rules = schema as Record<string, unknown>;

	if (Array.isArray(rules.anyOf)) {
		return rules.anyOf.some((variant) => matches(variant, value));
	}
	if (Array.isArray(rules.enum) && !rules.enum.includes(value as never)) {
		return false;
	}

	switch (rules.type) {
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number';
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value);
		case 'array':
			return Array.isArray(value) && value.every((entry) => matches(rules.items, entry));
		case 'object': {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
			const properties = (rules.properties ?? {}) as Record<string, unknown>;
			const entries = value as Record<string, unknown>;
			if (rules.additionalProperties === false) {
				if (Object.keys(entries).some((key) => !(key in properties))) return false;
			}
			const required = (rules.required ?? []) as string[];
			if (required.some((key) => !(key in entries))) return false;
			return Object.entries(entries).every(
				([key, entry]) => !(key in properties) || matches(properties[key], entry),
			);
		}
		default:
			return false;
	}
}

const SCORE = { score: 1, reason: 'because' };
const IDENTITY = { path: 'App/A[0]', file: 'src/App.tsx', line: 3, tag: 'A' };

const DS_NODE = {
	...IDENTITY,
	kind: 'ds',
	correctDsDecision: SCORE,
	correctDsUsage: SCORE,
};
const LOCAL_NODE = { ...IDENTITY, kind: 'local', correctLocalDecision: SCORE };

/** Whether the schema admits a response carrying exactly these nodes. */
function accepts(...nodes: unknown[]): boolean {
	return matches(JUDGE_OUTPUT_SCHEMA, { nodes });
}

describe('JUDGE_OUTPUT_SCHEMA', () => {
	it('accepts a fully answered node of each kind', () => {
		expect(accepts(DS_NODE, LOCAL_NODE)).toBe(true);
	});

	it('accepts an empty judgement', () => {
		expect(accepts()).toBe(true);
	});

	// The failure this schema exists to prevent: summariseJudgement counts such a
	// node as an evaluated DS node while it contributes to neither DS mean.
	it.each([
		['no DS scores at all', { ...IDENTITY, kind: 'ds' }],
		['only the decision score', { ...IDENTITY, kind: 'ds', correctDsDecision: SCORE }],
		['only the usage score', { ...IDENTITY, kind: 'ds', correctDsUsage: SCORE }],
	])('rejects a ds node with %s', (_label, node) => {
		expect(accepts(node)).toBe(false);
	});

	it('rejects a local node with no local score', () => {
		expect(accepts({ ...IDENTITY, kind: 'local' })).toBe(false);
	});

	// Cross-kind: a local node answering a DS question used to land in the DS
	// mean, because the summary averaged by key presence rather than by kind.
	it('rejects a local node carrying a DS score', () => {
		expect(accepts({ ...LOCAL_NODE, correctDsDecision: SCORE })).toBe(false);
	});

	it('rejects a ds node carrying the local score', () => {
		expect(accepts({ ...DS_NODE, correctLocalDecision: SCORE })).toBe(false);
	});

	it('rejects an unknown kind', () => {
		expect(accepts({ ...DS_NODE, kind: 'external' })).toBe(false);
	});

	it.each(['path', 'file', 'line', 'tag', 'kind'])('rejects a node missing %s', (key) => {
		const { [key]: _dropped, ...node } = DS_NODE as Record<string, unknown>;
		expect(accepts(node)).toBe(false);
	});

	it('rejects a score outside the three allowed values', () => {
		expect(accepts({ ...DS_NODE, correctDsUsage: { score: 0.75, reason: 'r' } })).toBe(false);
	});

	// A bare number is not reviewable, and it is the first thing anyone asks for.
	it('rejects a score with no reason', () => {
		expect(accepts({ ...DS_NODE, correctDsUsage: { score: 1 } })).toBe(false);
	});

	it('rejects a node carrying an undeclared property', () => {
		expect(accepts({ ...DS_NODE, confidence: 'high' })).toBe(false);
	});
});
