import type { EvalRunData } from '@vercel/agent-eval';
import { describe, expect, test } from 'vitest';
import { analyzeAgentRun } from './agent-analysis.ts';

function runData(transcript: string): EvalRunData {
	return {
		result: {
			duration: 1,
			status: 'passed',
		},
		transcript,
	};
}

function jsonl(events: unknown[]): string {
	return events.map((event) => JSON.stringify(event)).join('\n');
}

describe('analyzeAgentRun', () => {
	test('extracts Claude browser preview navigation URLs', () => {
		const analysis = analyzeAgentRun(
			runData(
				jsonl([
					{
						message: {
							content: [
								{
									input: {
										url: 'http://localhost:6006/?path=/story/components-badge--default',
									},
									name: 'mcp__browser__navigate',
									type: 'tool_use',
								},
							],
						},
						type: 'assistant',
					},
				]),
			),
			'claude-code',
		);

		expect(analysis.workflow.browserUrls).toEqual([
			'http://localhost:6006/?path=/story/components-badge--default',
		]);
	});

	test('extracts Codex browser preview navigation URLs', () => {
		const analysis = analyzeAgentRun(
			runData(
				jsonl([
					{
						input: {
							url: 'http://localhost:6006/iframe.html?id=components-badge--default',
						},
						tool: 'browser.open',
						type: 'tool_call',
					},
				]),
			),
			'codex',
		);

		expect(analysis.workflow.browserUrls).toEqual([
			'http://localhost:6006/iframe.html?id=components-badge--default',
		]);
	});
});
