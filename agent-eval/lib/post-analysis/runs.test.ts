import { vol } from 'memfs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findRuns, parseTimestamp } from './runs.ts';

vi.mock('node:fs', async () => {
	const memfs = await vi.importActual<typeof import('memfs')>('memfs');
	return { ...memfs.fs, default: memfs.fs };
});

const RESULTS = '/results';

afterEach(() => {
	vol.reset();
});

describe('findRuns', () => {
	it('parses the current agentic-ref layout (no model segment)', () => {
		vol.fromJSON({
			'/results/agentic-ref-cc-base-opus-high/2026-08-04T07-29-53.186Z/703-fix-bug-flow/run-1/project/x.txt':
				'',
			'/results/agentic-ref-cc-base-opus-high/2026-08-04T07-29-53.186Z/703-fix-bug-flow/run-2/project/x.txt':
				'',
		});
		const runs = findRuns(RESULTS);
		expect(runs).toHaveLength(2);
		expect(runs[0]).toMatchObject({
			experiment: 'agentic-ref-cc-base-opus-high',
			model: '',
			timestamp: '2026-08-04T07-29-53.186Z',
			evalName: '703-fix-bug-flow',
			run: 1,
			runDir:
				'/results/agentic-ref-cc-base-opus-high/2026-08-04T07-29-53.186Z/703-fix-bug-flow/run-1',
		});
	});

	it('parses the legacy layout with a model segment', () => {
		vol.fromJSON({
			'/results/agentic-ref-reuse/opus/2026-07-28T12-21-43.772Z/701-x/run-1/project/x.txt': '',
		});
		expect(findRuns(RESULTS)[0]).toMatchObject({ model: 'opus', evalName: '701-x' });
	});

	it('skips run-N dirs without a project/ child and non-run dirs', () => {
		vol.fromJSON({
			'/results/exp/2026-08-04T07-29-53.186Z/703-fix-bug-flow/run-1/result.json': '{}',
			'/results/exp/analysis-summary.json': '{}',
		});
		expect(findRuns(RESULTS)).toHaveLength(0);
	});

	it('returns [] for a missing directory', () => {
		expect(findRuns('/nope')).toEqual([]);
	});
});

describe('parseTimestamp', () => {
	it('parses the dashed on-disk form', () => {
		expect(parseTimestamp('2026-08-04T07-29-53.186Z')).toBe(Date.parse('2026-08-04T07:29:53.186Z'));
	});
});
