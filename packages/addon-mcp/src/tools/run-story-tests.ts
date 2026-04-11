import type { McpServer } from 'tmcp';
import { logger } from 'storybook/internal/node-logger';
import * as v from 'valibot';
import { fetchStoryIndex } from '../utils/fetch-story-index.ts';
import { findStoryIds, type FoundStory, type NotFoundStory } from '../utils/find-story-ids.ts';
import { errorToMCPContent } from '../utils/errors.ts';
import { collectTelemetry } from '../telemetry.ts';
import type { AddonContext } from '../types.ts';
import { StoryInputArray } from '../types.ts';
import type {
	TriggerTestRunRequestPayload,
	TriggerTestRunResponsePayload,
} from '@storybook/addon-vitest/constants';
import type Channel from 'storybook/internal/channels';
import type { StoryId } from 'storybook/internal/csf';
import type { A11yReport } from '@storybook/addon-a11y';
import { SCREENSHOT_REPORT_TYPE } from '../constants.ts';
import { RUN_STORY_TESTS_TOOL_NAME } from './tool-names.ts';

/**
 * Check if addon-vitest is available by trying to import its constants.
 * Returns the constants if available, undefined otherwise.
 */
export async function getAddonVitestConstants() {
	try {
		const mod = await import('@storybook/addon-vitest/constants');
		return {
			TRIGGER_TEST_RUN_REQUEST: mod.TRIGGER_TEST_RUN_REQUEST,
			TRIGGER_TEST_RUN_RESPONSE: mod.TRIGGER_TEST_RUN_RESPONSE,
		};
	} catch {
		return undefined;
	}
}

const RunStoryTestsInput = v.object({
	stories: v.optional(
		v.pipe(
			StoryInputArray,
			v.description(
				`Stories to test for focused feedback. Omit this field to run tests for all available stories.
Prefer running tests for specific stories while developing to get faster feedback,
and only omit this when you explicitly need to run all tests for comprehensive verification.
Prefer { storyId } when you don't already have story file context, since this avoids filesystem discovery.
Use { storyId } when IDs were discovered from documentation tools.
Use { absoluteStoryPath + exportName } only when you're currently working in a story file and already know those values.`,
			),
		),
	),
	a11y: v.optional(
		v.pipe(
			v.boolean(),
			v.description(
				'Whether to run accessibility tests. Defaults to true. Disable if you only need component test results.',
			),
		),
		true,
	),
	screenshot: v.optional(
		v.pipe(
			v.boolean(),
			v.description(
				'Whether to capture a final screenshot of each tested story and return it as MCP image content. Defaults to false.',
			),
		),
		false,
	),
});

/**
 * Creates a queue that ensures concurrent calls are executed in sequence.
 * Call `wait()` to wait for your turn, then call the
 * returned `done()` function when done to unblock the next caller.
 */
function createAsyncQueue() {
	let tail: Promise<void> = Promise.resolve();

	/**
	 * Wait for all previously queued operations to complete, then return
	 * a `done` function that must be called when the current operation finishes.
	 */
	async function wait(): Promise<() => void> {
		let done!: () => void;
		const gate = new Promise<void>((resolve) => {
			done = resolve;
		});

		const previousTail = tail;
		tail = previousTail.then(
			() => gate,
			() => gate,
		);

		await previousTail.catch(() => {});

		return done;
	}

	return { wait };
}

export async function addRunStoryTestsTool(
	server: McpServer<any, AddonContext>,
	{ a11yEnabled }: { a11yEnabled: boolean },
) {
	const addonVitestConstants = await getAddonVitestConstants();
	const testRunQueue = createAsyncQueue();

	const description =
		`Run story tests.
Provide stories for focused runs (faster while iterating),
or omit stories to run all tests for full-project verification.
Use this continuously to monitor test results as you work on your UI components and stories.
Results will include passing/failing status` +
		(a11yEnabled
			? `, and accessibility violation reports.
			${' '}Pass screenshot: true to attach final rendered story screenshots as MCP image content.
For visual/design accessibility violations (for example color contrast), ask the user before changing styles.`
			: '.');

	server.tool(
		{
			name: RUN_STORY_TESTS_TOOL_NAME,
			title: 'Storybook Tests',
			description,
			schema: RunStoryTestsInput,
			enabled: () => {
				if (!addonVitestConstants) {
					return false;
				}
				return server.ctx.custom?.toolsets?.test ?? true;
			},
		},
		async (input: v.InferInput<typeof RunStoryTestsInput>) => {
			let done: (() => void) | undefined;
			try {
				done = await testRunQueue.wait();
				const runA11y = input.a11y ?? true;
				const runScreenshot = input.screenshot ?? false;

				const { origin, options, disableTelemetry } = server.ctx.custom ?? {};

				if (!origin) {
					throw new Error('Origin is required in addon context');
				}

				if (!options) {
					throw new Error('Options are required in addon context');
				}

				// Access channel from options (available at runtime even though types don't declare it)
				const channel = (options as unknown as { channel: Channel }).channel;
				if (!channel) {
					throw new Error('Channel is not available');
				}

				let storyIds: string[] | undefined;
				let inputStoryCount = 0;

				if (input.stories) {
					const index = await fetchStoryIndex(origin);
					const resolvedStories = findStoryIds(index, input.stories);

					storyIds = resolvedStories
						.filter((story): story is FoundStory => 'id' in story)
						.map((story) => story.id);
					inputStoryCount = input.stories.length;

					if (storyIds.length === 0) {
						const errorMessages = resolvedStories
							.filter((story): story is NotFoundStory => 'errorMessage' in story)
							.map((story) => story.errorMessage)
							.join('\n');

						if (!disableTelemetry) {
							await collectTelemetry({
								event: 'tool:runStoryTests',
								server,
								toolset: 'test',
								runA11y,
								inputStoryCount,
								matchedStoryCount: 0,
								passingStoryCount: 0,
								failingStoryCount: 0,
								a11yViolationCount: 0,
								unhandledErrorCount: 0,
							});
						}

						return {
							content: [
								{
									type: 'text',
									text: `No stories found matching the provided input.

${errorMessages}`,
								},
							],
						};
					}

					logger.info(`Running focused tests for story IDs: ${storyIds.join(', ')}`);
				} else {
					logger.info('Running tests for all stories');
				}

				// Trigger test run via channel events
				const responsePayload = await triggerTestRun(
					channel,
					addonVitestConstants!.TRIGGER_TEST_RUN_REQUEST,
					addonVitestConstants!.TRIGGER_TEST_RUN_RESPONSE,
					storyIds,
					{
						a11y: runA11y,
						screenshot: runScreenshot,
					},
				);

				const testResults = responsePayload.result;
				if (!testResults) {
					throw new Error('Test run response missing result data');
				}

				const { content, summary } = formatRunStoryTestResults({
					testResults,
					runA11y,
					runScreenshot,
					origin,
				});

				if (!disableTelemetry) {
					await collectTelemetry({
						event: 'tool:runStoryTests',
						server,
						toolset: 'test',
						runA11y,
						inputStoryCount,
						matchedStoryCount: testResults.storyIds?.length ?? storyIds?.length ?? 0,
						...summary,
					});
				}

				return {
					content,
				};
			} catch (error) {
				return errorToMCPContent(error);
			} finally {
				try {
					done?.();
				} catch (error) {
					logger.warn(`Failed to release test run queue: ${String(error)}`);
				}
			}
		},
	);
}

/**
 * Trigger a test run via Storybook channel events.
 * This is the channel-based API for triggering tests in addon-vitest.
 */
function triggerTestRun(
	channel: Channel,
	triggerTestRunRequestEventName: string,
	triggerTestRunResponseEventName: string,
	storyIds: string[] | undefined,
	config?: TriggerTestRunRequestPayload['config'],
): Promise<TriggerTestRunResponsePayload> {
	/*
	Flow overview:
	1) Create a unique request ID for this invocation.
	2) Subscribe to the response event and emit a request event.
	3) Wait for exactly one terminal outcome for this request ID:
	   - completed (with result)
	   - error
	   - cancelled
	   - emit failure
	4) On the first terminal outcome, run cleanup once and settle once.
	*/
	return new Promise((resolve, reject) => {
		const requestId = `mcp-${Date.now()}`;
		/*
		Guard to ensure we never resolve/reject more than once.
		This protects against races between timeout, responses, and emit failures.
		*/
		let settled = false;

		/* Always remove listeners and timer when this request is done. */
		const cleanup = () => {
			channel.off(triggerTestRunResponseEventName, handleResponse);
		};

		/*
		Single exit point for all terminal states.
		It guarantees cleanup happens exactly once before resolve/reject.
		*/
		const settle = (callback: () => void) => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();
			callback();
		};

		const handleResponse = (payload: TriggerTestRunResponsePayload) => {
			/* Ignore responses from other trigger requests. */
			if (payload.requestId !== requestId) {
				return;
			}

			/* Map protocol response status to one terminal settlement path. */
			switch (payload.status) {
				case 'completed':
					/* Completed without result is considered malformed/incomplete. */
					if (payload.result) {
						settle(() => resolve(payload));
					} else {
						settle(() => reject(new Error('Test run completed but no result was returned')));
					}
					break;
				case 'error':
					settle(() =>
						reject(new Error(payload.error?.message ?? 'Test run failed with unknown error')),
					);
					break;
				case 'cancelled':
					settle(() => reject(new Error('Test run was cancelled')));
					break;
				default:
					settle(() => reject(new Error('Unexpected test run response')));
			}
		};

		/* Subscribe before emit so immediate/synchronous responders are not missed. */
		channel.on(triggerTestRunResponseEventName, handleResponse);

		const request = {
			requestId,
			actor: 'addon-mcp',
			storyIds,
			config,
		} as TriggerTestRunRequestPayload;

		try {
			/*
			Start the run. If emit throws synchronously, settle through the same
			path so cleanup still runs and callers get a proper rejection.
			*/
			channel.emit(triggerTestRunRequestEventName, request);
		} catch (error) {
			settle(() => reject(error instanceof Error ? error : new Error(String(error))));
		}
	});
}

interface RunStoryTestsSummary {
	passingStoryCount: number;
	failingStoryCount: number;
	a11yViolationCount: number;
	unhandledErrorCount: number;
}

interface TextResponseContent {
	type: 'text';
	text: string;
}

interface ImageResponseContent {
	type: 'image';
	data: string;
	mimeType: string;
}

type ToolResponseContent = TextResponseContent | ImageResponseContent;

interface StoryReport {
	type: string;
	status: 'failed' | 'passed' | 'warning';
	result: unknown;
}

interface ScreenshotReportResult {
	data?: string;
	mimeType?: string;
	message?: string;
}

interface ScreenshotArtifact {
	storyId: string;
	data: string;
	mimeType: string;
}

interface ScreenshotArtifactFailure {
	storyId: string;
	message: string;
}

interface A11yViolationNode {
	impact?: string;
	failureSummary?: string;
	message?: string;
	html?: string;
	linkPath?: string;
}

interface A11yViolation {
	id: string;
	description: string;
	nodes: A11yViolationNode[];
}

type TestRunResult = NonNullable<TriggerTestRunResponsePayload['result']>;

function formatRunStoryTestResults({
	testResults,
	runA11y,
	runScreenshot,
	origin,
}: {
	testResults: TestRunResult;
	runA11y: boolean;
	runScreenshot: boolean;
	origin: string;
}): { content: ToolResponseContent[]; summary: RunStoryTestsSummary } {
	const sections: string[] = [];
	const componentTestStatuses = testResults.componentTestStatuses;
	const reportsByStory = getStoryReports(testResults);

	const passingStories = componentTestStatuses.filter(
		(status) => status.value === 'status-value:success',
	);
	const failingStories = componentTestStatuses.filter(
		(status) => status.value === 'status-value:error',
	);

	if (passingStories.length > 0) {
		sections.push(formatPassingStoriesSection(passingStories));
	}

	if (failingStories.length > 0) {
		sections.push(formatFailingStoriesSection(failingStories));
	}

	const a11yReports = getA11yReports(testResults, reportsByStory);
	const a11yViolationCount = runA11y ? countA11yViolations(a11yReports) : 0;
	if (runA11y && a11yReports && Object.keys(a11yReports).length > 0) {
		const a11ySection = formatA11yReportsSection({ a11yReports, origin });
		if (a11ySection) {
			sections.push(a11ySection);
		}
	}

	const screenshots = runScreenshot ? getScreenshotArtifacts(reportsByStory) : undefined;
	if (screenshots?.images.length) {
		sections.push(formatScreenshotArtifactsSection(screenshots.images));
	}
	if (screenshots?.failures.length) {
		sections.push(formatScreenshotFailuresSection(screenshots.failures));
	}

	if (testResults.unhandledErrors.length > 0) {
		sections.push(formatUnhandledErrorsSection(testResults.unhandledErrors));
	}

	const text = sections.join('\n\n');
	const content: ToolResponseContent[] = [
		{
			type: 'text',
			text,
		},
	];

	if (screenshots?.images.length) {
		content.push(
			...screenshots.images.map((screenshot) => ({
				type: 'image' as const,
				data: screenshot.data,
				mimeType: screenshot.mimeType,
			})),
		);
	}

	return {
		content,
		summary: {
			passingStoryCount: passingStories.length,
			failingStoryCount: failingStories.length,
			a11yViolationCount,
			unhandledErrorCount: testResults.unhandledErrors.length,
		},
	};
}

function getStoryReports(testResults: TestRunResult): Record<StoryId, StoryReport[]> {
	const reports = (testResults as TestRunResult & { reports?: Record<StoryId, StoryReport[]> })
		.reports;
	if (!reports || typeof reports !== 'object') {
		return {};
	}

	return reports;
}

function getA11yReports(
	testResults: TestRunResult,
	reportsByStory: Record<StoryId, StoryReport[]>,
): Record<StoryId, A11yReport[]> {
	const legacyA11yReports = (
		testResults as TestRunResult & {
			a11yReports?: Record<StoryId, A11yReport[]>;
		}
	).a11yReports;
	if (legacyA11yReports && Object.keys(legacyA11yReports).length > 0) {
		return legacyA11yReports;
	}

	const a11yReports: Record<StoryId, A11yReport[]> = {};

	for (const [storyId, reports] of Object.entries(reportsByStory) as Array<
		[StoryId, StoryReport[]]
	>) {
		const storyA11yReports = reports
			.filter((report) => report.type === 'a11y')
			.map((report) => report.result)
			.filter((report): report is A11yReport => typeof report === 'object' && report !== null);

		if (storyA11yReports.length > 0) {
			a11yReports[storyId] = storyA11yReports;
		}
	}

	return a11yReports;
}

function getScreenshotArtifacts(reportsByStory: Record<StoryId, StoryReport[]>): {
	images: ScreenshotArtifact[];
	failures: ScreenshotArtifactFailure[];
} {
	const images: ScreenshotArtifact[] = [];
	const failures: ScreenshotArtifactFailure[] = [];

	for (const [storyId, reports] of Object.entries(reportsByStory)) {
		for (const report of reports) {
			if (report.type !== SCREENSHOT_REPORT_TYPE) {
				continue;
			}

			const result = report.result as ScreenshotReportResult | undefined;
			if (
				report.status === 'passed' &&
				typeof result?.data === 'string' &&
				typeof result.mimeType === 'string'
			) {
				images.push({
					storyId,
					data: result.data,
					mimeType: result.mimeType,
				});
				continue;
			}

			failures.push({
				storyId,
				message: getScreenshotFailureMessage(report.status, result),
			});
		}
	}

	return { images, failures };
}

function getScreenshotFailureMessage(
	status: StoryReport['status'],
	result: ScreenshotReportResult | undefined,
): string {
	if (typeof result?.message === 'string' && result.message.length > 0) {
		return result.message;
	}

	if (status === 'warning') {
		return 'Screenshot capture returned a warning.';
	}

	if (status === 'failed') {
		return 'Screenshot capture failed.';
	}

	return 'Screenshot capture returned an invalid payload.';
}

function formatPassingStoriesSection(passingStories: Array<{ storyId: string }>): string {
	return `## Passing Stories

- ${passingStories.map((status) => status.storyId).join('\n- ')}`;
}

function formatFailingStoriesSection(
	statuses: Array<{ storyId: string; description?: string }>,
): string {
	const entries = statuses.map(
		(status) =>
			`### ${status.storyId}

${status.description || 'No failure details available.'}`,
	);

	return `## Failing Stories

${entries.join('\n\n')}`;
}

function formatA11yReportsSection({
	a11yReports,
	origin,
}: {
	a11yReports: Record<StoryId, A11yReport[]>;
	origin: string;
}): string | undefined {
	const a11yViolationSections: string[] = [];

	for (const [storyId, reports] of Object.entries(a11yReports)) {
		for (const report of reports) {
			if ('error' in report && report.error) {
				a11yViolationSections.push(`### ${storyId} - Error

${report.error.message}`);
				continue;
			}

			const violations = getA11yViolations(report);
			if (violations.length === 0) {
				continue;
			}

			for (const violation of violations) {
				const nodes = violation.nodes
					.map((node) => {
						const inspectLink = node.linkPath ? `${origin}${node.linkPath}` : undefined;
						const parts = [] as string[];

						if (node.impact) {
							parts.push(`- **Impact**: ${node.impact}`);
						}

						if (node.failureSummary || node.message) {
							parts.push(`  **Message**: ${node.failureSummary || node.message}`);
						}

						parts.push(`  **Element**: ${node.html || '(no html available)'}`);

						if (inspectLink) {
							parts.push(`  **Inspect**: ${inspectLink}`);
						}

						return parts.join('\n');
					})
					.join('\n');

				a11yViolationSections.push(`### ${storyId} - ${violation.id}

${violation.description}

#### Affected Elements
${nodes}`);
			}
		}
	}

	if (a11yViolationSections.length === 0) {
		return undefined;
	}

	return `## Accessibility Violations

${a11yViolationSections.join('\n\n')}`;
}

function formatScreenshotArtifactsSection(images: ScreenshotArtifact[]): string {
	return `## Screenshots

- ${images.map((image) => image.storyId).join('\n- ')}`;
}

function formatScreenshotFailuresSection(failures: ScreenshotArtifactFailure[]): string {
	const formattedFailures = failures.map(
		(failure) => `### ${failure.storyId}

${failure.message}`,
	);

	return `## Screenshot Capture Errors

${formattedFailures.join('\n\n')}`;
}

function formatUnhandledErrorsSection(
	errors: Array<{
		name?: string;
		message?: string;
		stack?: string;
		VITEST_TEST_PATH?: string;
		VITEST_TEST_NAME?: string;
	}>,
): string {
	const formattedErrors = errors.map(
		(unhandledError) =>
			`### ${unhandledError.name || 'Unknown Error'}

**Error message**: ${unhandledError.message || 'No message available'}
**Path**: ${unhandledError.VITEST_TEST_PATH || 'No path available'}
**Test name**: ${unhandledError.VITEST_TEST_NAME || 'No test name available'}
**Stack trace**:
${unhandledError.stack || 'No stack trace available'}`,
	);

	return `## Unhandled Errors

${formattedErrors.join('\n\n')}`;
}

function countA11yViolations(a11yReports: Record<StoryId, A11yReport[]>): number {
	let count = 0;

	for (const reports of Object.values(a11yReports ?? {})) {
		for (const report of reports) {
			if ('error' in report && report.error) {
				continue;
			}

			count += getA11yViolations(report).length;
		}
	}

	return count;
}

function getA11yViolations(report: A11yReport): A11yViolation[] {
	if (!('violations' in report)) {
		return [];
	}

	const { violations } = report;
	if (!Array.isArray(violations)) {
		return [];
	}

	return violations.map((violation) => ({
		id: violation.id,
		description: violation.description,
		nodes: violation.nodes.map((node) => ({
			impact: typeof node.impact === 'string' ? node.impact : undefined,
			failureSummary: typeof node.failureSummary === 'string' ? node.failureSummary : undefined,
			html: typeof node.html === 'string' ? node.html : undefined,
			linkPath: typeof node.linkPath === 'string' ? node.linkPath : undefined,
		})),
	}));
}
