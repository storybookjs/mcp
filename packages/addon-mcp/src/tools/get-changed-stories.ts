import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import { experimental_getStatusStore } from 'storybook/internal/core-server';
import { collectTelemetry } from '../telemetry.ts';
import type { AddonContext } from '../types.ts';
import { errorToMCPContent } from '../utils/errors.ts';
import { getStoryIndex } from '../utils/get-story-index.ts';
import {
	detectUnreachableChanges,
	formatPartialCoverageBanner,
	formatPartialCoverageHint,
	formatUnreachableHint,
} from '../utils/detect-unreachable-changes.ts';
import {
	serializeChangedStories,
	emptyChangedStoriesStructured,
} from '../utils/serialize-changed-stories.ts';
import { GET_CHANGED_STORIES_TOOL_NAME, GET_STORIES_BY_COMPONENT_TOOL_NAME } from './tool-names.ts';

export const GET_CHANGED_STORIES_TOOL_DESCRIPTION = `Get Storybook stories marked as new, modified, or related. Returns story metadata only (no URLs).

New and modified stories (the directly-changed ones) are always returned in full. Related stories — those that only transitively render a changed component — can number in the thousands when a shared primitive (e.g. Badge, Tag, Icon) changes, so they are returned as a component-diverse sample plus complete per-component counts, keeping the response within tool-output limits. To enumerate every related story for one component, call \`${GET_STORIES_BY_COMPONENT_TOOL_NAME}\` with its source path.`;

const CHANGE_DETECTION_TYPE = 'storybook/change-detection';
const INCLUDED_STATUS_VALUES = new Set<StatusValue>([
	'status-value:new',
	'status-value:modified',
	'status-value:affected',
]);

type StatusValue =
	| 'status-value:pending'
	| 'status-value:success'
	| 'status-value:new'
	| 'status-value:modified'
	| 'status-value:affected'
	| 'status-value:warning'
	| 'status-value:error'
	| 'status-value:unknown';

type StatusesByStoryIdAndTypeId = Record<string, Record<string, Status>>;

interface Status {
	value: StatusValue;
	typeId: string;
	storyId: string;
	title: string;
	description: string;
	data?: any;
	sidebarContextMenu?: boolean;
}

interface ChangedStory {
	storyId: string;
	statusValue: StatusValue;
	title: string;
	name: string;
	importPath: string;
	distance?: number;
}

/**
 * Reads the import-graph distance the change-detection store may persist in
 * `status.data.distance`. Older Storybook builds don't set it; we treat that as
 * "unknown" so the serializer falls back to component-diverse ordering.
 */
function readDistance(data: unknown): number | undefined {
	if (data && typeof data === 'object' && 'distance' in data) {
		const value = (data as { distance?: unknown }).distance;
		if (typeof value === 'number' && Number.isFinite(value)) return value;
	}
	return undefined;
}

function statusPriority(statusValue: StatusValue): number {
	if (statusValue === 'status-value:new') return 0;
	if (statusValue === 'status-value:modified') return 1;
	return 2;
}

const ChangedStoryLiteSchema = v.object({
	storyId: v.string(),
	title: v.string(),
	name: v.string(),
	importPath: v.string(),
	distance: v.pipe(
		v.optional(v.number()),
		v.description(
			'Import-graph distance from the changed source (1 = direct importer, 2+ = transitive). Lower = more likely to render the change. Omitted when the Storybook build does not report it.',
		),
	),
});

export const GetChangedStoriesOutput = v.object({
	counts: v.pipe(
		v.object({
			new: v.number(),
			modified: v.number(),
			related: v.number(),
			total: v.number(),
		}),
		v.description(
			'Total story counts per bucket. `related` is the FULL number of transitively-affected stories, even when only a sample is listed below.',
		),
	),
	new: v.array(ChangedStoryLiteSchema),
	modified: v.array(ChangedStoryLiteSchema),
	relatedSample: v.pipe(
		v.array(ChangedStoryLiteSchema),
		v.description(
			'A component-diverse sample of related stories. A subset of `counts.related` when `relatedTruncated` is true.',
		),
	),
	relatedBreakdown: v.pipe(
		v.array(
			v.object({
				title: v.string(),
				count: v.number(),
				nearestDistance: v.optional(v.number()),
			}),
		),
		v.description(
			'Per-component story counts across ALL related stories (top components when many), with each component\'s nearest distance when known.',
		),
	),
	relatedTruncated: v.boolean(),
	relatedBreakdownTruncated: v.boolean(),
	newTruncated: v.boolean(),
	modifiedTruncated: v.boolean(),
});

export function getChangedStoriesToolMetadata() {
	return {
		name: GET_CHANGED_STORIES_TOOL_NAME,
		title: 'Get changed stories metadata',
		description: GET_CHANGED_STORIES_TOOL_DESCRIPTION,
		outputSchema: GetChangedStoriesOutput,
	};
}

export async function addGetChangedStoriesTool(
	server: McpServer<any, AddonContext>,
	enabled: Parameters<McpServer<any, AddonContext>['tool']>[0]['enabled'] = () =>
		server.ctx.custom?.toolsets?.dev ?? true,
) {
	server.tool(
		{
			...getChangedStoriesToolMetadata(),
			enabled,
		},
		async () => {
			try {
				const { options, disableTelemetry } = server.ctx.custom ?? {};
				if (!options) {
					throw new Error('Storybook options are required in addon context');
				}

				const statusStore = experimental_getStatusStore(CHANGE_DETECTION_TYPE);
				const allStatuses = statusStore.getAll() as StatusesByStoryIdAndTypeId;
				const changedStoriesFromStatusStore: Status[] = [];
				for (const byType of Object.values(allStatuses)) {
					const status = byType?.[CHANGE_DETECTION_TYPE];
					if (status?.value && INCLUDED_STATUS_VALUES.has(status.value)) {
						changedStoriesFromStatusStore.push(status);
					}
				}

				if (changedStoriesFromStatusStore.length === 0) {
					if (!disableTelemetry) {
						await collectTelemetry({
							event: 'tool:getChangedStories',
							server,
							toolset: 'dev',
							storyCount: 0,
							newStoryCount: 0,
							modifiedStoryCount: 0,
							affectedStoryCount: 0,
						});
					}

					// Empty result doesn't mean "nothing to review" — files may be
					// modified outside the story graph (theme tokens, decorators,
					// utilities consumed at preview-runtime). Surface those so the
					// agent knows to fall back to grep + get-stories-by-component
					// rather than reporting "no impact".
					const unreachable = await detectUnreachableChanges();
					const hint = formatUnreachableHint(unreachable);

					return {
						content: [
							{
								type: 'text' as const,
								text: `No new, modified, or related stories detected.${hint}`,
							},
						],
						structuredContent: emptyChangedStoriesStructured(),
					};
				}

				const index = await getStoryIndex(options);
				const stories = changedStoriesFromStatusStore.flatMap<ChangedStory>(
					({ storyId, value, data }) => {
						const entry = index.entries[storyId];
						if (!entry) {
							return [];
						}
						return [
							{
								storyId,
								statusValue: value,
								title: entry.title,
								name: entry.name,
								importPath: entry.importPath,
								distance: readDistance(data),
							},
						];
					},
				);

				stories.sort((a, b) => {
					const priorityDelta = statusPriority(a.statusValue) - statusPriority(b.statusValue);
					return priorityDelta !== 0 ? priorityDelta : a.storyId.localeCompare(b.storyId);
				});

				const buckets = {
					new: stories.filter((story) => story.statusValue === 'status-value:new'),
					modified: stories.filter((story) => story.statusValue === 'status-value:modified'),
					affected: stories.filter((story) => story.statusValue === 'status-value:affected'),
				};
				const counts = {
					new: buckets.new.length,
					modified: buckets.modified.length,
					affected: buckets.affected.length,
				};

				if (!disableTelemetry) {
					await collectTelemetry({
						event: 'tool:getChangedStories',
						server,
						toolset: 'dev',
						storyCount: stories.length,
						newStoryCount: counts.new,
						modifiedStoryCount: counts.modified,
						affectedStoryCount: counts.affected,
					});
				}

				// Detect unreachable working-tree files first so the banner can
				// front-load the warning. With a long story list (Chromatic-scale)
				// the tail-positioned `formatPartialCoverageHint` can land past
				// host-side tool-output truncation caps; the leading banner is the
				// salience aid that survives. Tail hint also stays for agents that
				// read the full response.
				const unreachable = await detectUnreachableChanges();
				const banner = formatPartialCoverageBanner(unreachable);

				// Serialize within a token budget: new/modified are kept in full,
				// the related/affected bucket is reduced to a component-diverse
				// sample plus per-component counts. This is the fix for the
				// overflow that silently spilled the response to a file and dropped
				// review coverage on large repos (mcp#311).
				const { headline, body, structured } = serializeChangedStories(buckets);

				const text =
					`${banner}${headline}` +
					(body ? `\n\n${body}` : '') +
					formatPartialCoverageHint(unreachable);

				return {
					content: [{ type: 'text' as const, text }],
					structuredContent: structured,
				};
			} catch (error) {
				return errorToMCPContent(error);
			}
		},
	);
}
