import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import { collectTelemetry } from '../telemetry.ts';
import { buildArgsParam } from '../utils/build-args-param.ts';
import { fetchStoryIndex } from '../utils/fetch-story-index.ts';
import { findStoryIds } from '../utils/find-story-ids.ts';
import { errorToMCPContent } from '../utils/errors.ts';
import { isPlaywrightAvailable, takeScreenshot } from '../utils/browser-manager.ts';
import type { AddonContext } from '../types.ts';
import { StoryInput } from '../types.ts';
import { SCREENSHOT_STORY_TOOL_NAME } from './tool-names.ts';

const ScreenshotStoryInput = v.object({
	story: v.pipe(
		StoryInput,
		v.description(
			`Story to screenshot.
Prefer { storyId } when you don't already have story file context, since this avoids filesystem discovery.
Use { storyId } when IDs were discovered from documentation tools.
Use { absoluteStoryPath + exportName } only when you're already working in a specific .stories.* file and already have that context.`,
		),
	),
	viewport: v.optional(
		v.pipe(
			v.object({
				width: v.pipe(v.number(), v.integer(), v.minValue(1)),
				height: v.pipe(v.number(), v.integer(), v.minValue(1)),
			}),
			v.description('Viewport size for the screenshot. Defaults to 1280x720.'),
		),
	),
	omitBackground: v.optional(
		v.pipe(
			v.boolean(),
			v.description(
				'Whether to hide the default white background and capture with transparency. Defaults to false.',
			),
		),
	),
	fullPage: v.optional(
		v.pipe(
			v.boolean(),
			v.description(
				'Whether to capture the full scrollable page instead of the viewport. Defaults to false.',
			),
		),
	),
});

export async function addScreenshotStoryTool(server: McpServer<any, AddonContext>) {
	const playwrightAvailable = await isPlaywrightAvailable();

	server.tool(
		{
			name: SCREENSHOT_STORY_TOOL_NAME,
			title: 'Screenshot a story',
			description: `Use this tool to capture a PNG screenshot of a rendered Storybook story.
Returns an image of the component as it appears in the browser, useful for visual verification.
Requires Playwright to be installed.`,
			schema: ScreenshotStoryInput,
			enabled: () => {
				if (!playwrightAvailable) {
					return false;
				}
				return server.ctx.custom?.toolsets?.dev ?? true;
			},
		},
		async (input) => {
			try {
				const { origin, disableTelemetry } = server.ctx.custom ?? {};

				if (!origin) {
					throw new Error('Origin is required in addon context');
				}

				const index = await fetchStoryIndex(origin);
				const resolvedStories = findStoryIds(index, [input.story]);
				const resolved = resolvedStories[0]!;

				if ('errorMessage' in resolved) {
					return {
						content: [{ type: 'text', text: resolved.errorMessage }],
						isError: true,
					};
				}

				const indexEntry = index.entries[resolved.id];
				if (!indexEntry) {
					return {
						content: [
							{ type: 'text', text: `No story found for story ID "${resolved.id}"` },
						],
						isError: true,
					};
				}

				// Build iframe URL for isolated story rendering
				let iframeUrl = `${origin}/iframe.html?id=${resolved.id}&viewMode=story`;

				const argsParam = buildArgsParam(input.story.props ?? {});
				if (argsParam) {
					iframeUrl += `&args=${argsParam}`;
				}

				const globalsParam = buildArgsParam(input.story.globals ?? {});
				if (globalsParam) {
					iframeUrl += `&globals=${globalsParam}`;
				}

				const screenshot = await takeScreenshot({
					url: iframeUrl,
					viewport: input.viewport,
					omitBackground: input.omitBackground,
					fullPage: input.fullPage,
				});

				if (!disableTelemetry) {
					await collectTelemetry({
						event: 'tool:screenshotStory',
						server,
						toolset: 'dev',
					});
				}

				return {
					content: [
						{
							type: 'image',
							data: screenshot.toString('base64'),
							mimeType: 'image/png',
						},
						{
							type: 'text',
							text: `Screenshot of story "${indexEntry.title} / ${indexEntry.name}" (${resolved.id})`,
						},
					],
				};
			} catch (error) {
				return errorToMCPContent(error);
			}
		},
	);
}
