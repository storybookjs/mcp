import { describe, expect, it } from 'vitest';
import { extractMcpToolsSummary } from './mcp-tools.ts';

function createTranscriptWithMcpToolUse({
	toolName,
	input,
}: {
	toolName: string;
	input: Record<string, unknown>;
}) {
	// We only need the subset of the transcript schema that `extractMcpToolsSummary` reads.
	return [
		{
			type: 'assistant',
			message: {
				content: [
					{
						type: 'tool_use',
						isMCP: true,
						id: 'tool-use-1',
						name: toolName,
						input,
					},
				],
			},
		},
		{
			type: 'user',
			tokenCount: 40,
			message: {
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'tool-use-1',
						content: [{ type: 'text', text: 'ok' }],
					},
				],
			},
		},
	] as any;
}

describe('mcp-tools grader expectedCalls matching', () => {
	it('matches expectedCalls as deep partial input patterns', () => {
		const messages = createTranscriptWithMcpToolUse({
			toolName: 'mcp__storybook-dev-mcp__run-story-tests',
			input: {
				stories: [
					{
						absoluteStoryPath: '/abs/path/to/Foo.stories.tsx',
						exportName: 'Bar',
					},
				],
				a11y: false,
			},
		});

		const summary = extractMcpToolsSummary(messages, {
			'run-story-tests': {
				expectedCalls: [{ a11y: false }],
			},
		});

		expect(summary.allExpectationsPassed).toBe(true);
		expect(summary.calledExpectedToolCount).toBe(1);

		const runTool = summary.tools.find((t) => t.name.includes('run-story-tests'));
		expect(runTool?.validation?.inputMatch).toBe(true);
	});

	it('fails validation when expectedCalls does not match any invocation', () => {
		const messages = createTranscriptWithMcpToolUse({
			toolName: 'mcp__storybook-dev-mcp__run-story-tests',
			input: {
				stories: [
					{
						absoluteStoryPath: '/abs/path/to/Foo.stories.tsx',
						exportName: 'Bar',
					},
				],
				a11y: false,
			},
		});

		const summary = extractMcpToolsSummary(messages, {
			'run-story-tests': {
				expectedCalls: [{ a11y: true }],
			},
		});

		expect(summary.allExpectationsPassed).toBe(false);

		const runTool = summary.tools.find((t) => t.name.includes('run-story-tests'));
		expect(runTool?.validation?.inputMatch).toBe(false);
	});
});

describe('mcp-tools grader call count matching', () => {
	it('passes when minCalls is satisfied', () => {
		const messages = [
			...createTranscriptWithMcpToolUse({
				toolName: 'mcp__storybook-dev-mcp__run-story-tests',
				input: { a11y: false },
			}),
			...createTranscriptWithMcpToolUse({
				toolName: 'mcp__storybook-dev-mcp__run-story-tests',
				input: { a11y: false },
			}),
		] as any;

		const summary = extractMcpToolsSummary(messages, {
			'run-story-tests': {
				minCalls: 2,
			},
		});

		expect(summary.allExpectationsPassed).toBe(true);
		const runTool = summary.tools.find((t) => t.name.includes('run-story-tests'));
		expect(runTool?.callCount).toBe(2);
		expect(runTool?.validation?.minCallsMet).toBe(true);
	});

	it('fails when minCalls is not satisfied', () => {
		const messages = createTranscriptWithMcpToolUse({
			toolName: 'mcp__storybook-dev-mcp__run-story-tests',
			input: { a11y: false },
		});

		const summary = extractMcpToolsSummary(messages, {
			'run-story-tests': {
				minCalls: 2,
			},
		});

		expect(summary.allExpectationsPassed).toBe(false);
		const runTool = summary.tools.find((t) => t.name.includes('run-story-tests'));
		expect(runTool?.callCount).toBe(1);
		expect(runTool?.validation?.minCallsMet).toBe(false);
	});

	it('fails when maxCalls is exceeded', () => {
		const messages = [
			...createTranscriptWithMcpToolUse({
				toolName: 'mcp__storybook-dev-mcp__run-story-tests',
				input: { a11y: false },
			}),
			...createTranscriptWithMcpToolUse({
				toolName: 'mcp__storybook-dev-mcp__run-story-tests',
				input: { a11y: false },
			}),
		] as any;

		const summary = extractMcpToolsSummary(messages, {
			'run-story-tests': {
				maxCalls: 1,
			},
		});

		expect(summary.allExpectationsPassed).toBe(false);
		const runTool = summary.tools.find((t) => t.name.includes('run-story-tests'));
		expect(runTool?.callCount).toBe(2);
		expect(runTool?.validation?.maxCallsMet).toBe(false);
	});
});
