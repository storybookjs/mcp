import { estimateTokens } from './estimate-tokens.ts';

/**
 * The story fields this serializer reads. Bucket membership (new / modified /
 * affected) is carried by the {@link ChangedStoryBuckets} key, not a field, so
 * callers can pass richer objects (extra fields are ignored).
 */
export interface ChangedStory {
	storyId: string;
	title: string;
	name: string;
	importPath: string;
	/**
	 * Import-graph distance from the changed source to this story (0 = the story
	 * file itself, 1 = direct importer, 2+ = transitive). Optional: only present
	 * when the Storybook change-detection store persists it. When present it is
	 * used to rank the related sample toward the consumers that actually render
	 * the change; when absent the sample falls back to component-diverse order.
	 */
	distance?: number;
}

export interface ChangedStoryBuckets {
	new: ChangedStory[];
	modified: ChangedStory[];
	/** "Related"/transitively-affected stories — the bucket that explodes on shared components. */
	affected: ChangedStory[];
}

/**
 * Compact, machine-readable form of a changed story for `structuredContent`.
 * Mirrors the markdown line but without the formatting.
 */
export interface ChangedStoryLite {
	storyId: string;
	title: string;
	name: string;
	importPath: string;
	/** See {@link ChangedStory.distance}. Omitted when unknown. */
	distance?: number;
}

export interface ComponentBreakdownEntry {
	title: string;
	count: number;
	/** Closest distance any of this component's related stories sits at. Omitted when unknown. */
	nearestDistance?: number;
}

export interface ChangedStoriesStructured {
	counts: {
		new: number;
		modified: number;
		/** Total number of related stories detected (NOT the number sampled below). */
		related: number;
		total: number;
	};
	/** Directly-changed stories. Always complete unless `newTruncated`/`modifiedTruncated`. */
	new: ChangedStoryLite[];
	modified: ChangedStoryLite[];
	/** A bounded, component-diverse sample of the related stories. */
	relatedSample: ChangedStoryLite[];
	/** Per-component counts across ALL related stories (top components only when many). */
	relatedBreakdown: ComponentBreakdownEntry[];
	/** `true` when `relatedSample` is a subset of all related stories. */
	relatedTruncated: boolean;
	/** `true` when `relatedBreakdown` lists only the top components. */
	relatedBreakdownTruncated: boolean;
	newTruncated: boolean;
	modifiedTruncated: boolean;
}

export interface SerializedChangedStories {
	/** Headline line, e.g. "Detected 312 changed stories (1 new, 2 modified, 309 related)." */
	headline: string;
	/** Bounded markdown body: the bucket sections plus any truncation notes. */
	body: string;
	/** Structured, equally-bounded payload for `structuredContent`. */
	structured: ChangedStoriesStructured;
}

/**
 * Default budgets. These keep the response comfortably under host-side
 * tool-output token caps (Claude/MCP default ≈ 25k tokens) while still being
 * lean enough that the agent isn't flooded with low-signal related stories.
 *
 * The directly-changed buckets (new/modified) are the point of the feature and
 * are kept in full up to a generous cap. The "related"/affected bucket — the
 * one that reaches thousands of lines when a shared primitive like `Tag` or
 * `Badge` changes — is reduced to a component-diverse sample plus a complete
 * per-component count, so the agent learns the full breadth without paying for
 * every individual story.
 */
export interface SerializeOptions {
	/** Max related stories listed individually. */
	relatedSampleLimit?: number;
	/** Max components listed in the per-component breakdown. */
	breakdownLimit?: number;
	/** Max directly-changed (new OR modified) stories listed individually, each. */
	directDisplayLimit?: number;
	/**
	 * Hard ceiling on estimated tokens for `body`. A backstop for pathological
	 * cases (e.g. a refactor touching hundreds of components directly); the
	 * per-bucket limits above normally keep us well under it.
	 */
	tokenBudget?: number;
}

const DEFAULT_RELATED_SAMPLE_LIMIT = 40;
const DEFAULT_BREAKDOWN_LIMIT = 25;
const DEFAULT_DIRECT_DISPLAY_LIMIT = 100;
const DEFAULT_TOKEN_BUDGET = 12000;
/** Floors so budget trimming never collapses a section to nothing useful. */
const RELATED_SAMPLE_FLOOR = 10;
const DIRECT_DISPLAY_FLOOR = 20;

/** The structured payload for "no changed stories", reused by early returns. */
export function emptyChangedStoriesStructured(): ChangedStoriesStructured {
	return {
		counts: { new: 0, modified: 0, related: 0, total: 0 },
		new: [],
		modified: [],
		relatedSample: [],
		relatedBreakdown: [],
		relatedTruncated: false,
		relatedBreakdownTruncated: false,
		newTruncated: false,
		modifiedTruncated: false,
	};
}

function toLite(story: ChangedStory): ChangedStoryLite {
	return {
		storyId: story.storyId,
		title: story.title,
		name: story.name,
		importPath: story.importPath,
		...(typeof story.distance === 'number' ? { distance: story.distance } : {}),
	};
}

function serializeStory(
	{ storyId, title, name, importPath, distance }: ChangedStory,
	{ withDistance = false }: { withDistance?: boolean } = {},
): string {
	// Distance is a ranking aid for the related sample; the directly-changed
	// new/modified buckets ARE the change, so they're serialized without it.
	const suffix = withDistance && typeof distance === 'number' ? ` — distance ${distance}` : '';
	return `- \`${storyId}\`: ${title} / ${name} (\`${importPath}\`)${suffix}`;
}

function pluralize(n: number, singular: string, plural = `${singular}s`): string {
	return n === 1 ? singular : plural;
}

/** Distance used for ordering when a story carries none — sorts last. */
const NO_DISTANCE = Number.POSITIVE_INFINITY;
function distanceOf(story: ChangedStory): number {
	return typeof story.distance === 'number' ? story.distance : NO_DISTANCE;
}

/**
 * Builds a per-component count over ALL related stories, plus each component's
 * nearest (smallest) distance when distances are known. Sorted nearest-first,
 * then by story count, so the agent sees the most-directly-affected components
 * at the head of the breakdown.
 */
function buildBreakdown(affected: ChangedStory[]): ComponentBreakdownEntry[] {
	const counts = new Map<string, number>();
	const nearest = new Map<string, number>();
	for (const story of affected) {
		counts.set(story.title, (counts.get(story.title) ?? 0) + 1);
		const d = distanceOf(story);
		nearest.set(story.title, Math.min(nearest.get(story.title) ?? NO_DISTANCE, d));
	}
	return [...counts.entries()]
		.map(([title, count]) => {
			const near = nearest.get(title)!;
			return Number.isFinite(near)
				? { title, count, nearestDistance: near }
				: { title, count };
		})
		.sort(
			(a, b) =>
				(a.nearestDistance ?? NO_DISTANCE) - (b.nearestDistance ?? NO_DISTANCE) ||
				b.count - a.count ||
				a.title.localeCompare(b.title),
		);
}

/**
 * Picks a component-diverse, relevance-ranked sample of related stories.
 *
 * Round-robins across components so a single high-fan-out component (one that
 * appears in 900 stories) can't crowd out every other affected component — and,
 * when distances are known, takes the CLOSEST story within each component first
 * and visits components in nearest-distance order. The net effect (strategy "F"
 * in the overflow experiments): every affected component is represented by its
 * most-likely-to-render story before any component gets a second slot. Without
 * distances it degrades to plain component round-robin (still maximal breadth).
 */
function sampleRelated(affected: ChangedStory[], limit: number): ChangedStory[] {
	if (affected.length <= limit) {
		return [...affected].sort((a, b) => distanceOf(a) - distanceOf(b));
	}

	const order = new Map(affected.map((s, i) => [s.storyId, i]));
	const byTitle = new Map<string, ChangedStory[]>();
	for (const story of affected) {
		const bucket = byTitle.get(story.title) ?? [];
		bucket.push(story);
		byTitle.set(story.title, bucket);
	}
	// Closest-first within each component (stable on the original order for ties).
	for (const bucket of byTitle.values()) {
		bucket.sort(
			(a, b) => distanceOf(a) - distanceOf(b) || (order.get(a.storyId)! - order.get(b.storyId)!),
		);
	}
	// Visit components in nearest-distance order, then by descending fan-out.
	const queues = [...byTitle.values()].sort(
		(a, b) => distanceOf(a[0]!) - distanceOf(b[0]!) || b.length - a.length,
	);

	const sample: ChangedStory[] = [];
	let exhausted = false;
	while (sample.length < limit && !exhausted) {
		exhausted = true;
		for (const queue of queues) {
			if (queue.length === 0) continue;
			sample.push(queue.shift()!);
			exhausted = false;
			if (sample.length >= limit) break;
		}
	}
	// Present the chosen sample closest-first for a readable, prioritized list.
	sample.sort((a, b) => distanceOf(a) - distanceOf(b) || (order.get(a.storyId)! - order.get(b.storyId)!));
	return sample;
}

function formatBreakdown(
	breakdown: ComponentBreakdownEntry[],
	limit: number,
): { text: string; truncated: boolean; shown: ComponentBreakdownEntry[] } {
	const shown = breakdown.slice(0, limit);
	const hiddenComponents = breakdown.length - shown.length;
	const parts = shown.map((entry) =>
		typeof entry.nearestDistance === 'number'
			? `${entry.title} (×${entry.count}, nearest d${entry.nearestDistance})`
			: `${entry.title} (×${entry.count})`,
	);
	let text = `By component: ${parts.join(', ')}`;
	if (hiddenComponents > 0) {
		const hiddenStories = breakdown
			.slice(limit)
			.reduce((sum, entry) => sum + entry.count, 0);
		text += `, +${hiddenComponents} more ${pluralize(hiddenComponents, 'component')} (${hiddenStories} ${pluralize(hiddenStories, 'story', 'stories')})`;
	}
	return { text, truncated: hiddenComponents > 0, shown };
}

interface DirectSection {
	text: string;
	/** The stories actually rendered — the single source of truth for the structured payload. */
	shown: ChangedStory[];
	truncated: boolean;
}

function formatDirectBucket(
	heading: string,
	stories: ChangedStory[],
	displayLimit: number,
): DirectSection {
	const shown = stories.slice(0, displayLimit);
	const hidden = stories.length - shown.length;
	let text = `${heading}:\n${shown.map((s) => serializeStory(s)).join('\n')}`;
	if (hidden > 0) {
		text += `\n- …and ${hidden} more (omitted to stay within the response size limit; all ${stories.length} are in \`structuredContent.counts\`).`;
	}
	return { text, shown, truncated: hidden > 0 };
}

interface RelatedSection {
	text: string;
	sample: ChangedStory[];
	truncated: boolean;
	breakdownShown: ComponentBreakdownEntry[];
	breakdownTruncated: boolean;
}

function formatRelatedSection(
	affected: ChangedStory[],
	sampleLimit: number,
	breakdownLimit: number,
): RelatedSection {
	const total = affected.length;
	const sample = sampleRelated(affected, sampleLimit);
	const truncated = sample.length < total;
	const breakdown = buildBreakdown(affected);
	const {
		text: breakdownText,
		truncated: breakdownTruncated,
		shown: breakdownShown,
	} = formatBreakdown(breakdown, breakdownLimit);

	const headerCount = truncated
		? `Related stories (${total} total — showing a ${sample.length}-story sample across components):`
		: `Related stories (${total}):`;

	let text = `${headerCount}\n${breakdownText}\n\n${sample
		.map((s) => serializeStory(s, { withDistance: true }))
		.join('\n')}`;

	if (truncated) {
		text +=
			`\n\nShowing ${sample.length} of ${total} related stories — one representative per affected component (closest by import distance first, when known). ` +
			`Related stories transitively render a changed component — they are lower priority than the new/modified stories, ` +
			`which are listed in full. To enumerate every story for a specific component, call \`get-stories-by-component\` with that component's source path. ` +
			`Do not assume the un-sampled stories are unaffected, and never invent story IDs.`;
	}

	return { text, sample, truncated, breakdownShown, breakdownTruncated };
}

/**
 * Serializes the changed-story buckets into a bounded markdown body plus an
 * equally-bounded structured payload. Guarantees the body's estimated token
 * count stays at/under `tokenBudget` by trimming the related sample first, then
 * (only in pathological cases) the directly-changed buckets — always emitting
 * an explicit truncation note rather than silently dropping content.
 */
export function serializeChangedStories(
	buckets: ChangedStoryBuckets,
	options: SerializeOptions = {},
): SerializedChangedStories {
	const relatedSampleLimit = options.relatedSampleLimit ?? DEFAULT_RELATED_SAMPLE_LIMIT;
	const breakdownLimit = options.breakdownLimit ?? DEFAULT_BREAKDOWN_LIMIT;
	const directDisplayLimit = options.directDisplayLimit ?? DEFAULT_DIRECT_DISPLAY_LIMIT;
	const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

	const counts = {
		new: buckets.new.length,
		modified: buckets.modified.length,
		related: buckets.affected.length,
	};
	const total = counts.new + counts.modified + counts.related;

	const headline = `Detected ${total} changed ${pluralize(total, 'story', 'stories')} (${counts.new} new, ${counts.modified} modified, ${counts.related} related).`;

	// Build with the default limits, then trim down to the token budget. The
	// related sample is trimmed first (lowest signal), then the direct buckets.
	let effectiveSampleLimit = relatedSampleLimit;
	let effectiveDirectLimit = directDisplayLimit;

	const assemble = () => {
		const sections: string[] = [];
		const newSection =
			buckets.new.length > 0
				? formatDirectBucket('New stories', buckets.new, effectiveDirectLimit)
				: null;
		const modifiedSection =
			buckets.modified.length > 0
				? formatDirectBucket('Modified stories', buckets.modified, effectiveDirectLimit)
				: null;
		const relatedSection =
			buckets.affected.length > 0
				? formatRelatedSection(buckets.affected, effectiveSampleLimit, breakdownLimit)
				: null;

		if (newSection) sections.push(newSection.text);
		if (modifiedSection) sections.push(modifiedSection.text);
		if (relatedSection) sections.push(relatedSection.text);

		return {
			body: sections.join('\n\n'),
			newSection,
			modifiedSection,
			relatedSection,
		};
	};

	let assembled = assemble();
	// Trim to fit the budget. Each step reduces the lowest-priority knob still
	// above its floor; the loop is bounded by those floors.
	while (estimateTokens(`${headline}\n\n${assembled.body}`) > tokenBudget) {
		if (effectiveSampleLimit > RELATED_SAMPLE_FLOOR) {
			effectiveSampleLimit = Math.max(RELATED_SAMPLE_FLOOR, Math.floor(effectiveSampleLimit / 2));
		} else if (effectiveDirectLimit > DIRECT_DISPLAY_FLOOR) {
			effectiveDirectLimit = Math.max(DIRECT_DISPLAY_FLOOR, Math.floor(effectiveDirectLimit / 2));
		} else {
			break; // Floors reached; this is as small as we go.
		}
		assembled = assemble();
	}

	const { newSection, modifiedSection, relatedSection } = assembled;

	const structured: ChangedStoriesStructured = {
		counts: { new: counts.new, modified: counts.modified, related: counts.related, total },
		// Derived straight from what each section rendered — no independent
		// re-slicing, so the markdown and structured payload can't diverge.
		new: (newSection?.shown ?? []).map(toLite),
		modified: (modifiedSection?.shown ?? []).map(toLite),
		relatedSample: (relatedSection?.sample ?? []).map(toLite),
		relatedBreakdown: relatedSection?.breakdownShown ?? [],
		relatedTruncated: relatedSection?.truncated ?? false,
		relatedBreakdownTruncated: relatedSection?.breakdownTruncated ?? false,
		newTruncated: newSection?.truncated ?? false,
		modifiedTruncated: modifiedSection?.truncated ?? false,
	};

	return { headline, body: assembled.body, structured };
}
