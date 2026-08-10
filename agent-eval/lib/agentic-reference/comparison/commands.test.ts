import { describe, expect, it } from 'vitest';

import type { ResolvedCase } from './resolve.ts';
import { formatGapTable, remediationCommands } from './commands.ts';

const DO_DONT: ResolvedCase = {
	caseName: 'cc-do-dont-opus-high',
	experiment: 'agentic-ref-cc-do-dont-opus-high',
	shortName: 'do-dont',
};
const FULL: ResolvedCase = {
	caseName: 'cc-full-opus-high',
	experiment: 'agentic-ref-cc-full-opus-high',
	shortName: 'full',
};

describe('remediationCommands', () => {
	it('groups collection gaps per experiment with workflows comma-joined', () => {
		expect(
			remediationCommands([
				{ case: DO_DONT, workflow: '703-fix-bug-flow', have: 0, need: 10, reason: 'missing-runs' },
				{ case: DO_DONT, workflow: '701-new-ui-flow', have: 3, need: 10, reason: 'missing-runs' },
				{ case: FULL, workflow: '701-new-ui-flow', have: 2, need: 10, reason: 'stale-analysis' },
			]),
		).toEqual([
			'AGENTIC_REF_FLOW=701-new-ui-flow,703-fix-bug-flow AGENTIC_REF_RUNS=10 pnpm eval:agentic-ref agentic-ref-cc-do-dont-opus-high',
			'pnpm results:analyze --experiment=agentic-ref-cc-do-dont-opus-high',
			'pnpm results:analyze --recompute --experiment=agentic-ref-cc-full-opus-high',
		]);
	});

	it('emits a plain analyze command for unanalyzed gaps', () => {
		expect(
			remediationCommands([
				{ case: FULL, workflow: '703-fix-bug-flow', have: 4, need: 10, reason: 'unanalyzed' },
			]),
		).toEqual(['pnpm results:analyze --experiment=agentic-ref-cc-full-opus-high']);
	});

	it('follows a collection command with an analyze command for the same experiment', () => {
		expect(
			remediationCommands([
				{ case: DO_DONT, workflow: '703-fix-bug-flow', have: 0, need: 10, reason: 'missing-runs' },
			]),
		).toEqual([
			'AGENTIC_REF_FLOW=703-fix-bug-flow AGENTIC_REF_RUNS=10 pnpm eval:agentic-ref agentic-ref-cc-do-dont-opus-high',
			'pnpm results:analyze --experiment=agentic-ref-cc-do-dont-opus-high',
		]);
	});

	it('gets a collect command and a recompute command, not a duplicate analyze line, when an experiment has both missing-runs and stale gaps', () => {
		expect(
			remediationCommands([
				{ case: DO_DONT, workflow: '703-fix-bug-flow', have: 0, need: 10, reason: 'missing-runs' },
				{ case: DO_DONT, workflow: '701-new-ui-flow', have: 4, need: 10, reason: 'stale-analysis' },
			]),
		).toEqual([
			'AGENTIC_REF_FLOW=703-fix-bug-flow AGENTIC_REF_RUNS=10 pnpm eval:agentic-ref agentic-ref-cc-do-dont-opus-high',
			'pnpm results:analyze --recompute --experiment=agentic-ref-cc-do-dont-opus-high',
		]);
	});

	it('pins Math.max: two missing-runs gaps with differing need values collect at the larger need', () => {
		expect(
			remediationCommands([
				{ case: DO_DONT, workflow: '703-fix-bug-flow', have: 0, need: 3, reason: 'missing-runs' },
				{ case: DO_DONT, workflow: '701-new-ui-flow', have: 0, need: 10, reason: 'missing-runs' },
			]),
		).toEqual([
			'AGENTIC_REF_FLOW=701-new-ui-flow,703-fix-bug-flow AGENTIC_REF_RUNS=10 pnpm eval:agentic-ref agentic-ref-cc-do-dont-opus-high',
			'pnpm results:analyze --experiment=agentic-ref-cc-do-dont-opus-high',
		]);
	});
});

describe('formatGapTable', () => {
	it('renders one aligned line per gap', () => {
		const table = formatGapTable([
			{ case: DO_DONT, workflow: '703-fix-bug-flow', have: 0, need: 10, reason: 'missing-runs' },
		]);
		expect(table).toContain('case');
		expect(table).toContain('do-dont');
		expect(table).toContain('0/10');
		expect(table).toContain('missing-runs');
	});
});
