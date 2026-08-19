import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AGENT_EVAL_ROOT } from './constants.ts';
import { loadPlanConfig, resolvePlanPath } from './plan-config.ts';

describe('resolvePlanPath', () => {
	it('expands a bare plan name into plans/<name>.plan.ts under the repo', () => {
		expect(resolvePlanPath('1-levels-edit')).toBe(
			join(AGENT_EVAL_ROOT, 'plans', '1-levels-edit.plan.ts'),
		);
	});

	it('resolves a relative path against the repo root', () => {
		expect(resolvePlanPath('plans/1-levels-edit.plan.ts')).toBe(
			join(AGENT_EVAL_ROOT, 'plans', '1-levels-edit.plan.ts'),
		);
	});

	it('keeps an absolute path as it is', () => {
		expect(resolvePlanPath('/elsewhere/custom.plan.ts')).toBe('/elsewhere/custom.plan.ts');
	});
});

describe('loadPlanConfig', () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'plan-config-'));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it('loads the default-exported plan', async () => {
		const path = join(root, 'ok.plan.ts');
		writeFileSync(
			path,
			"export default { experiments: ['a'], evals: ['701'], runs: 2, parallelMax: 4 };\n",
		);
		await expect(loadPlanConfig(path)).resolves.toMatchObject({ runs: 2, parallelMax: 4 });
	});

	it('rejects a missing config by path', async () => {
		await expect(loadPlanConfig(join(root, 'gone.plan.ts'))).rejects.toThrow(/gone\.plan\.ts/);
	});

	it('rejects a module that does not default-export an object', async () => {
		const path = join(root, 'bad.plan.ts');
		writeFileSync(path, 'export const nope = 1;\n');
		await expect(loadPlanConfig(path)).rejects.toThrow(/must default-export a RunPlan/);
	});
});
