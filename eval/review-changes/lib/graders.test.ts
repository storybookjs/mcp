import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
	gradeAll,
	gradeSchemaValid,
	gradeSurfacing,
	gradeKindCorrectness,
	gradeCollectionPurity,
	gradeChangedFilesAccuracy,
	classifyRun,
	depthToKind,
} from './graders.ts';
import { ReviewFixtureSchema, type ReviewFixture, type ReviewState } from './schema.ts';

const fixture: ReviewFixture = v.parse(ReviewFixtureSchema, {
	scenarioId: 'test',
	recordedAt: '2026-01-01T00:00:00.000Z',
	taskFraming: 'test',
	diff: '',
	changedFiles: ['src/components/button/button.tsx'],
	diffHunks: [],
	storyIndex: { entries: {} },
	changedStories: [
		{
			storyId: 'a--1',
			statusValue: 'status-value:modified',
			title: 'A',
			name: '1',
			importPath: 'a.tsx',
		},
		{
			storyId: 'a--2',
			statusValue: 'status-value:modified',
			title: 'A',
			name: '2',
			importPath: 'a.tsx',
		},
		{
			storyId: 'b--1',
			statusValue: 'status-value:affected',
			title: 'B',
			name: '1',
			importPath: 'b.tsx',
		},
		{
			storyId: 'c--1',
			statusValue: 'status-value:affected',
			title: 'C',
			name: '1',
			importPath: 'c.tsx',
		},
	],
	cascade: [
		{ storyId: 'a--1', depth: 0 },
		{ storyId: 'a--2', depth: 0 },
		{ storyId: 'b--1', depth: 1 },
		{ storyId: 'c--1', depth: 2 },
	],
	groundTruth: {
		importantStoryIds: ['a--1', 'b--1', 'c--1'],
		expectedKinds: {
			'a--1': 'atomic',
			'a--2': 'atomic',
			'b--1': 'consumer',
			'c--1': 'transitive',
		},
	},
	source: {
		repoPath: '/tmp/test-repo',
		baseCommit: 'deadbeef',
		workingTreeDirty: true,
	},
});

const perfectPayload: ReviewState = {
	title: 'Perfect',
	description: 'Perfect',
	collections: [
		{ title: 'A', rationale: 'atomic', sampleStoryIds: ['a--1', 'a--2'], kind: 'atomic' },
		{ title: 'B', rationale: 'consumer', sampleStoryIds: ['b--1'], kind: 'consumer' },
		{ title: 'C', rationale: 'transitive', sampleStoryIds: ['c--1'], kind: 'transitive' },
	],
	changedFiles: ['src/components/button/button.tsx'],
	diffHunks: [{ path: 'src/components/button/button.tsx', hunk: '@@ ' }],
};

describe('gradeSchemaValid', () => {
	it('accepts a well-formed payload', () => {
		expect(gradeSchemaValid(perfectPayload).valid).toBe(true);
	});
	it('rejects an empty object', () => {
		expect(gradeSchemaValid({}).valid).toBe(false);
	});
});

describe('gradeSurfacing', () => {
	it('100/100 recall and precision when pushed = important', () => {
		const result = gradeSurfacing(
			{
				title: 'x',
				description: 'x',
				collections: [{ title: 'l', rationale: 'r', sampleStoryIds: ['a--1', 'b--1', 'c--1'] }],
			},
			fixture,
		);
		expect(result?.recall).toBe(1);
		expect(result?.precision).toBe(1);
		expect(result?.f1).toBe(1);
	});

	it('penalises false positives', () => {
		const result = gradeSurfacing(perfectPayload, fixture);
		// a--2 is an extra
		expect(result?.recall).toBe(1);
		expect(result?.precision).toBeCloseTo(3 / 4, 5);
	});

	it('zero when nothing pushed', () => {
		expect(gradeSurfacing(undefined, fixture)?.recall).toBe(0);
	});

	it('returns undefined when fixture is unlabelled', () => {
		const unlabelled = { ...fixture, groundTruth: { ...fixture.groundTruth, importantStoryIds: undefined } };
		expect(gradeSurfacing(perfectPayload, unlabelled)).toBeUndefined();
	});
});

describe('gradeKindCorrectness', () => {
	it('1 when all collections match modal expected kind', () => {
		expect(gradeKindCorrectness(perfectPayload, fixture)).toBe(1);
	});
	it('0 when all wrong', () => {
		const wrong: ReviewState = {
			title: 'x',
			description: 'x',
			collections: [
				{ title: 'A', rationale: 'r', sampleStoryIds: ['a--1'], kind: 'transitive' },
				{ title: 'B', rationale: 'r', sampleStoryIds: ['b--1'], kind: 'atomic' },
			],
		};
		expect(gradeKindCorrectness(wrong, fixture)).toBe(0);
	});
	it('undefined (n/a) when there is no cascade or expectedKinds to grade against', () => {
		// A capture whose post-run cascade snapshot is empty (e.g. the
		// subdirectory-target path bug): there are no depth-derived expected
		// kinds, so kindCorrectness must be n/a — not a misleading 0%.
		const noGroundTruth: ReviewFixture = v.parse(ReviewFixtureSchema, {
			scenarioId: 'test',
			recordedAt: '2026-01-01T00:00:00.000Z',
			taskFraming: 'test',
			diff: '',
			changedFiles: ['src/components/button/button.tsx'],
			diffHunks: [],
			storyIndex: { entries: {} },
			changedStories: [],
			groundTruth: {},
			source: { repoPath: '/tmp/test-repo', baseCommit: 'deadbeef', workingTreeDirty: true },
		});
		expect(gradeKindCorrectness(perfectPayload, noGroundTruth)).toBeUndefined();
		expect(gradeAll(perfectPayload, noGroundTruth).kindCorrectness).toBeUndefined();
	});
});

describe('gradeCollectionPurity', () => {
	it('1 for single-kind collections', () => {
		expect(gradeCollectionPurity(perfectPayload, fixture)).toBe(1);
	});
	it('0.5 for an evenly-mixed collection of two kinds', () => {
		const mixed: ReviewState = {
			title: 'x',
			description: 'x',
			collections: [{ title: 'mixed', rationale: 'r', sampleStoryIds: ['a--1', 'b--1'] }],
		};
		expect(gradeCollectionPurity(mixed, fixture)).toBe(0.5);
	});
});

describe('gradeChangedFilesAccuracy', () => {
	it('1 when sets match', () => {
		expect(gradeChangedFilesAccuracy(perfectPayload, fixture)).toBe(1);
	});
	it('0 when entirely disjoint', () => {
		expect(
			gradeChangedFilesAccuracy(
				{ ...perfectPayload, changedFiles: ['unrelated.tsx'] },
				fixture,
			),
		).toBe(0);
	});
});

describe('gradeAll', () => {
	it('produces every score for the perfect payload', () => {
		const result = gradeAll(perfectPayload, fixture);
		expect(result.schemaValid).toBe(true);
		expect(result.surfacingRecall).toBe(1);
		expect(result.kindCorrectness).toBe(1);
		expect(result.collectionPurity).toBe(1);
		expect(result.diffHunksProvided).toBe(true);
	});
});

describe('depthToKind', () => {
	it('maps the changed component and its own story (depth 0–1) to atomic', () => {
		expect(depthToKind(0)).toBe('atomic');
		expect(depthToKind(1)).toBe('atomic');
	});
	it('maps a direct consumer (depth 2) to consumer', () => {
		expect(depthToKind(2)).toBe('consumer');
	});
	it('maps deeper stories (depth ≥3) to transitive', () => {
		expect(depthToKind(3)).toBe('transitive');
		expect(depthToKind(6)).toBe('transitive');
	});
});

describe('classifyRun', () => {
	it('ok when a schema-valid payload was pushed', () => {
		expect(classifyRun({ schemaValid: true, hasPushed: true })).toBe('ok');
	});
	it('agent-error when nothing was pushed', () => {
		expect(classifyRun({ schemaValid: false, hasPushed: false })).toBe('agent-error');
	});
	it('infra-error for a Storybook restart failure', () => {
		expect(
			classifyRun({
				error: 'Storybook restart failed: Port 6010 did not free within 10000ms',
				schemaValid: false,
				hasPushed: false,
			}),
		).toBe('infra-error');
	});
	it('timeout when the wall-clock cap fired', () => {
		expect(
			classifyRun({
				error: 'claude subprocess exceeded 300000ms',
				schemaValid: false,
				hasPushed: false,
			}),
		).toBe('timeout');
	});
});
