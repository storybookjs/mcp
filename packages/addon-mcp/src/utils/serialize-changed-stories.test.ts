import { describe, it, expect } from 'vitest';
import {
	serializeChangedStories,
	type ChangedStory,
	type ChangedStoryBuckets,
} from './serialize-changed-stories.ts';
import { estimateTokens } from './estimate-tokens.ts';

function story(
	id: string,
	title: string,
	name: string,
	importPath = `./src/${title}.stories.tsx`,
): ChangedStory {
	return { storyId: id, title, name, importPath };
}

function emptyBuckets(overrides: Partial<ChangedStoryBuckets> = {}): ChangedStoryBuckets {
	return { new: [], modified: [], affected: [], ...overrides };
}

/**
 * Builds N affected stories spread across `componentCount` components, mirroring
 * the real "shared primitive changed" shape where one edit fans out to stories
 * of many other components.
 */
function manyAffected(total: number, componentCount = 20): ChangedStory[] {
	const out: ChangedStory[] = [];
	for (let i = 0; i < total; i++) {
		const comp = i % componentCount;
		const title = `Comp${String(comp).padStart(2, '0')}`;
		out.push(
			story(
				`comp${comp}-story-${i}--default`,
				title,
				`Variant ${i}`,
				`./packages/react/src/components/${title}/${title}.stories.tsx`,
			),
		);
	}
	return out;
}

describe('serializeChangedStories', () => {
	it('lists every bucket in full when small', () => {
		const { headline, body, structured } = serializeChangedStories(
			emptyBuckets({
				new: [story('button--primary', 'Button', 'Primary')],
				modified: [story('button--secondary', 'Button', 'Secondary')],
				affected: [story('input--default', 'Input', 'Default')],
			}),
		);

		expect(headline).toBe('Detected 3 changed stories (1 new, 1 modified, 1 related).');
		expect(body).toContain('New stories:');
		expect(body).toContain('Modified stories:');
		expect(body).toContain('Related stories (1):');
		expect(body).toContain('By component: Input (×1)');
		expect(structured.counts).toEqual({ new: 1, modified: 1, related: 1, total: 3 });
		expect(structured.relatedTruncated).toBe(false);
		// Nothing was dropped.
		expect(body).not.toMatch(/Showing \d+ of \d+/);
	});

	it('uses singular "story" in the headline for a single change', () => {
		const { headline } = serializeChangedStories(emptyBuckets({ new: [story('a--b', 'A', 'B')] }));
		expect(headline).toBe('Detected 1 changed story (1 new, 0 modified, 0 related).');
	});

	it('caps the related bucket to a sample but reports the FULL related count', () => {
		const affected = manyAffected(1047, 20);
		const { headline, body, structured } = serializeChangedStories(
			emptyBuckets({
				new: [story('metrictile--default', 'MetricTile', 'Default')],
				modified: [story('tag--with-count', 'Tag', 'WithCount')],
				affected,
			}),
		);

		// Full counts are always truthful.
		expect(headline).toBe('Detected 1049 changed stories (1 new, 1 modified, 1047 related).');
		expect(structured.counts.related).toBe(1047);

		// The sample is bounded.
		expect(structured.relatedSample.length).toBeLessThanOrEqual(40);
		expect(structured.relatedTruncated).toBe(true);
		expect(body).toMatch(/Showing \d+ of 1047 related stories/);
		expect(body).toContain('get-stories-by-component');
	});

	it('keeps the entire response well under the tool-output token limit on a huge affected set', () => {
		const affected = manyAffected(1047, 20);
		const { headline, body } = serializeChangedStories(
			emptyBuckets({
				new: [story('metrictile--default', 'MetricTile', 'Default')],
				modified: [story('tag--with-count', 'Tag', 'WithCount')],
				affected,
			}),
		);
		const tokens = estimateTokens(`${headline}\n\n${body}`);
		// The pre-fix output for 1047 stories was ~56k tokens. The MCP/Claude
		// default cap is ~25k. We stay comfortably below it.
		expect(tokens).toBeLessThan(12000);
	});

	it('NEVER drops new or modified stories even when affected is huge (the carbon MetricTile regression)', () => {
		const affected = manyAffected(1047, 20);
		const { body, structured } = serializeChangedStories(
			emptyBuckets({
				new: [story('metrictile--default', 'MetricTile', 'Default')],
				modified: [story('tag--with-count', 'Tag', 'WithCount')],
				affected,
			}),
		);

		// The new component — the most important thing to review — survives.
		expect(body).toContain('`metrictile--default`');
		expect(body).toContain('`tag--with-count`');
		expect(structured.new).toEqual([
			{
				storyId: 'metrictile--default',
				title: 'MetricTile',
				name: 'Default',
				importPath: './src/MetricTile.stories.tsx',
			},
		]);
		expect(structured.newTruncated).toBe(false);
		expect(structured.modifiedTruncated).toBe(false);
	});

	it('samples related stories diversely across components (no single component crowds out the rest)', () => {
		// 1000 stories but 900 belong to one component; round-robin must still
		// surface the other 19 components in the sample.
		const affected: ChangedStory[] = [];
		for (let i = 0; i < 900; i++) affected.push(story(`hot-${i}--d`, 'HotComponent', `V${i}`));
		for (let c = 1; c < 20; c++) {
			for (let i = 0; i < 5; i++) affected.push(story(`c${c}-${i}--d`, `Comp${c}`, `V${i}`));
		}

		const { structured } = serializeChangedStories(emptyBuckets({ affected }));
		const sampledTitles = new Set(structured.relatedSample.map((s) => s.title));
		// Many distinct components appear, not just HotComponent.
		expect(sampledTitles.size).toBeGreaterThan(10);
		expect(sampledTitles.has('HotComponent')).toBe(true);
	});

	it('shows a per-component breakdown over ALL related stories, capping the component list when there are many', () => {
		const affected = manyAffected(600, 50); // 50 distinct components
		const { body, structured } = serializeChangedStories(emptyBuckets({ affected }), {
			breakdownLimit: 25,
		});
		expect(structured.relatedBreakdownTruncated).toBe(true);
		expect(structured.relatedBreakdown.length).toBe(25);
		expect(body).toMatch(/\+\d+ more components/);
	});

	it('respects a custom relatedSampleLimit', () => {
		const affected = manyAffected(500, 10);
		const { structured } = serializeChangedStories(emptyBuckets({ affected }), {
			relatedSampleLimit: 12,
		});
		expect(structured.relatedSample.length).toBe(12);
	});

	it('caps pathological direct buckets via the token-budget backstop, with an explicit note', () => {
		// A refactor touching 1000 components directly — new+modified alone would
		// overflow. The budget backstop must trim them too, and say so.
		const modified: ChangedStory[] = [];
		for (let i = 0; i < 1000; i++) modified.push(story(`m${i}--d`, `Mod${i}`, 'Default'));

		const { headline, body, structured } = serializeChangedStories(emptyBuckets({ modified }));
		const tokens = estimateTokens(`${headline}\n\n${body}`);
		expect(tokens).toBeLessThan(12000);
		expect(structured.counts.modified).toBe(1000);
		expect(structured.modifiedTruncated).toBe(true);
		expect(body).toMatch(/and \d+ more/);
	});

	describe('distance-aware ranking (strategy F)', () => {
		// Build affected stories across components, each with a realistic distance.
		function affectedWithDistances(total: number, componentCount: number): ChangedStory[] {
			const out: ChangedStory[] = [];
			for (let i = 0; i < total; i++) {
				const comp = i % componentCount;
				const title = `Comp${String(comp).padStart(2, '0')}`;
				// Deterministic skewed distribution: a few d1, more d2/d3/d4.
				const r = (i * 2654435761) % 100;
				const distance = r < 6 ? 1 : r < 26 ? 2 : r < 66 ? 3 : 4;
				out.push({ ...story(`c${comp}-s${i}--d`, title, `V${i}`), distance });
			}
			return out;
		}

		it('represents every affected component AND prefers the closest story per component', () => {
			const affected = affectedWithDistances(1047, 30);
			const { structured } = serializeChangedStories(emptyBuckets({ affected }), {
				relatedSampleLimit: 40,
			});
			const distinct = new Set(structured.relatedSample.map((s) => s.title));
			// Max breadth: all 30 components surface in a 40-story sample.
			expect(distinct.size).toBe(30);
			// Relevance: average distance is near 1 (closest-per-component first),
			// far better than the distance-blind ~3 of plain round-robin.
			const avg =
				structured.relatedSample.reduce((a, s) => a + (s.distance ?? 0), 0) /
				structured.relatedSample.length;
			expect(avg).toBeLessThan(1.5);
		});

		it('annotates related lines with their distance and the breakdown with nearest distance', () => {
			const affected = affectedWithDistances(200, 10);
			const { body, structured } = serializeChangedStories(emptyBuckets({ affected }));
			expect(body).toMatch(/— distance \d/);
			expect(body).toMatch(/nearest d\d/);
			expect(structured.relatedBreakdown[0]).toHaveProperty('nearestDistance');
			expect(structured.relatedSample[0]).toHaveProperty('distance');
		});

		it('orders the sample closest-first', () => {
			const affected = affectedWithDistances(500, 15);
			const { structured } = serializeChangedStories(emptyBuckets({ affected }));
			const distances = structured.relatedSample.map((s) => s.distance ?? 0);
			const sorted = [...distances].sort((a, b) => a - b);
			expect(distances).toEqual(sorted);
		});

		it('degrades to component-diverse order when no distances are present', () => {
			const affected = manyAffected(1047, 20); // no distance field
			const { body, structured } = serializeChangedStories(emptyBuckets({ affected }));
			// Still bounded + diverse, just no distance annotations.
			expect(structured.relatedSample.length).toBe(40);
			expect(new Set(structured.relatedSample.map((s) => s.title)).size).toBe(20);
			expect(body).not.toMatch(/— distance/);
			expect(structured.relatedSample[0]).not.toHaveProperty('distance');
		});
	});

	it('produces an empty body when there are no changed stories', () => {
		const { headline, body } = serializeChangedStories(emptyBuckets());
		expect(headline).toBe('Detected 0 changed stories (0 new, 0 modified, 0 related).');
		expect(body).toBe('');
	});
});
