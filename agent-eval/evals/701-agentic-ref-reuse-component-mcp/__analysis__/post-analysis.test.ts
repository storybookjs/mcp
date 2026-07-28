import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { analyzeRun, summarize } from '../post-analysis.ts';
import goldenResult from './__fixtures__/golden-run/result.json' with { type: 'json' };
import goldenTranscript from './__fixtures__/golden-run/transcript.json' with { type: 'json' };

let root: string;

function writeTree(name: string, files: Record<string, string>): string {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		const full = join(dir, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	return dir;
}

function context(overrides: Record<string, unknown> = {}) {
	// resolveRefDir is injected by default so the suite never downloads the real
	// 20MB ref; tests that care about the diff supply both trees explicitly.
	const defaultRef = writeTree('default-ref', { 'src/a.ts': 'function a(){ return 0; }\n' });
	return {
		resolveRefDir: () => defaultRef,
		// Must accompany resolveRefDir: without it `before` is read from the real
		// committed Mealdrop baseline, which knows nothing of these fixture trees.
		baselineDir: join(root, 'baselines'),
		runDir: join(root, 'run'),
		projectDir: writeTree('project', {
			'src/a.ts': 'function a(x){ if (x) return 1; return 0; }\n',
		}),
		fixtureDir: join(root, 'fixture'),
		experiment: 'agentic-ref-reuse-component-cc-mcp-opus-high',
		model: 'opus',
		timestamp: '2026-07-28T12-21-43.772Z',
		evalName: '701-agentic-ref-reuse-component-mcp',
		run: 1,
		result: goldenResult,
		readTranscript: () => goldenTranscript,
		...overrides,
	};
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'post-analysis-'));
	mkdirSync(join(root, 'run'), { recursive: true });
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('analyzeRun', () => {
	it('reports the golden run speed, cost and tool-use figures', async () => {
		const row = await analyzeRun(context());

		expect(row?.speed).toEqual({ durationSeconds: 403.365, turns: 12 });
		expect(row?.cost).toMatchObject({
			inputTokens: 53157,
			outputTokens: 8239,
			totalTokens: 1208645,
			estimatedCostUsd: 1.89273325,
			totalToolCalls: 25,
		});
		expect((row?.cost as { cacheHitRate: number }).cacheHitRate).toBeCloseTo(0.833, 4);
		expect(row?.toolUse).toMatchObject({
			buckets: { docs: 1, exploration: 14, edit: 8, verification: 7, other: 0 },
		});
		expect((row?.churn as { perFile: Record<string, number> }).perFile).toMatchObject({
			'src/components/Footer/Footer.tsx': 3,
		});
	});

	it('carries run identity through to the record', async () => {
		const row = await analyzeRun(context());
		expect(row).toMatchObject({
			experiment: 'agentic-ref-reuse-component-cc-mcp-opus-high',
			eval: '701-agentic-ref-reuse-component-mcp',
			run: 1,
			model: 'opus',
			status: 'failed',
		});
	});

	it('computes a complexity delta against the baseline', async () => {
		// ref: `function a(){ return 0; }` is cyclomatic 1, cognitive 0.
		// project: adds an `if`, so cyclomatic 2, cognitive 1.
		const row = await analyzeRun(context());
		expect(row?.complexity).toMatchObject({
			cyclomatic: { before: 1, after: 2, delta: 1 },
			cognitive: { before: 0, after: 1, delta: 1 },
			parseFailures: [],
		});
	});

	it('nulls transcript metrics when the transcript is unreadable', async () => {
		const row = await analyzeRun(
			context({
				readTranscript: () => {
					throw new Error('missing');
				},
			}),
		);
		expect(row?.toolUse).toBeNull();
		expect(row?.churn).toBeNull();
		// Non-transcript metrics still computed.
		expect(row?.speed).toEqual({ durationSeconds: 403.365, turns: 12 });
	});

	it('nulls densityPerSloc when no lines changed', async () => {
		// Identical ref and project trees: sloc.net is 0, so the ratio has no
		// denominator. resolveRefDir keeps this offline and deterministic.
		const identical = 'function a(x){ if (x) return 1; return 0; }\n';
		const refDir = writeTree('ref', { 'src/a.ts': identical });
		const row = await analyzeRun(
			context({
				projectDir: writeTree('same', { 'src/a.ts': identical }),
				resolveRefDir: () => refDir,
			}),
		);
		const complexity = row?.complexity as { densityPerSloc: number | null } | null;
		expect(complexity?.densityPerSloc ?? null).toBeNull();
		expect((row?.diff as { sloc: { net: number } }).sloc.net).toBe(0);
	});

	it('returns null when the run records no usable pin', async () => {
		const row = await analyzeRun(context({ result: { status: 'failed' } }));
		expect(row).toBeNull();
	});

	it('writes analysis.json next to result.json', async () => {
		const ctx = context();
		await analyzeRun(ctx);
		const written = JSON.parse(readFileSync(join(ctx.runDir, 'analysis.json'), 'utf8'));
		expect(written.speed.turns).toBe(12);
	});

	it('never stores Infinity or NaN', async () => {
		const row = await analyzeRun(context());
		const serialised = JSON.stringify(row);
		expect(serialised).not.toContain('Infinity');
		expect(serialised).not.toContain('NaN');
		expect(serialised).not.toContain('null,null');
	});
});

describe('summarize', () => {
	it('groups by experiment and eval, and reports means', () => {
		const rows = [
			{
				experiment: 'x',
				eval: 'e',
				status: 'passed',
				fixtureRef: 'r@1',
				cost: { estimatedCostUsd: 1 },
				speed: { durationSeconds: 10 },
				toolUse: { buckets: { docs: 2, exploration: 4 } },
			},
			{
				experiment: 'x',
				eval: 'e',
				status: 'failed',
				fixtureRef: 'r@1',
				cost: { estimatedCostUsd: 3 },
				speed: { durationSeconds: 20 },
				toolUse: { buckets: { docs: 0, exploration: 8 } },
			},
		];
		const [group] = summarize(rows);
		expect(group).toMatchObject({ experiment: 'x', eval: 'e', runs: 2, passed: 1 });
		expect((group?.costUsd as { total: number }).total).toBe(4);
		expect((group?.durationSeconds as { mean: number }).mean).toBe(15);
		expect((group?.docCalls as { mean: number }).mean).toBe(1);
	});

	it('reports null cost rather than zero when no run priced', () => {
		const rows = [
			{
				experiment: 'x',
				eval: 'e',
				status: 'passed',
				fixtureRef: 'r@1',
				cost: { estimatedCostUsd: null },
				speed: {},
				toolUse: null,
			},
		];
		const [group] = summarize(rows);
		expect((group?.costUsd as { total: number | null }).total).toBeNull();
	});

	it('flags a group spanning more than one fixture pin', () => {
		const rows = [
			{
				experiment: 'x',
				eval: 'e',
				status: 'passed',
				fixtureRef: 'r@1',
				cost: {},
				speed: {},
				toolUse: null,
			},
			{
				experiment: 'x',
				eval: 'e',
				status: 'passed',
				fixtureRef: 'r@2',
				cost: {},
				speed: {},
				toolUse: null,
			},
		];
		expect((summarize(rows)[0]?.fixtureRefs as string[]).length).toBe(2);
	});
});
