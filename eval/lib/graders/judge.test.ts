import { describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { resolveJudgePromptFile, parseJudgeScore, renderJudgePromptTemplate } from './judge.ts';

describe('judge parsing', () => {
	it('parses simple JSON', () => {
		const score = parseJudgeScore('{"score":0.5}');
		expect(score).toBe(0.5);
	});

	it('clamps score to [0, 1]', () => {
		expect(parseJudgeScore('{"score":2}')).toBe(1);
		expect(parseJudgeScore('{"score":-1}')).toBe(0);
	});

	it('accepts fenced JSON', () => {
		const raw = '```json\n{"score":0.75}\n```';
		const score = parseJudgeScore(raw);
		expect(score).toBe(0.75);
	});

	it('throws if no JSON object', () => {
		expect(() => {
			parseJudgeScore('score: 0.2');
		}).toThrow(/JSON object/i);
	});

	it('throws if score missing', () => {
		expect(() => {
			parseJudgeScore('{"ok":true}');
		}).toThrow(/score/i);
	});
});

describe('judge prompt resolution', () => {
	it('returns undefined when judge.md does not exist', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-judge-'));
		try {
			const resolved = await resolveJudgePromptFile(dir);
			expect(resolved).toBeUndefined();
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it('auto-detects judge.md when present', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-judge-'));
		try {
			await fs.writeFile(path.join(dir, 'judge.md'), 'Judge me');
			const resolved = await resolveJudgePromptFile(dir);
			expect(resolved).toContain(path.join(dir, 'judge.md'));
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});

describe('judge template placeholders', () => {
	it('renders FINAL_ASSISTANT_MESSAGE placeholder', async () => {
		const transcript = {
			prompt: 'p',
			promptTokenCount: 0,
			promptCost: 0,
			messages: [],
		} as any;

		const { renderedPrompt, usedPlaceholders } = await renderJudgePromptTemplate(
			'Evaluate this: {{FINAL_ASSISTANT_MESSAGE}}',
			{
				projectPath: '/tmp',
				resultsPath: '/tmp',
				transcript,
				finalAssistantText: 'Final answer text',
			},
		);

		expect(usedPlaceholders).toBe(true);
		expect(renderedPrompt).toContain('Final answer text');
	});

	it('renders PROJECT_FILE and RESULTS_FILE placeholders', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-judge-template-'));
		const projectPath = path.join(dir, 'project');
		const resultsPath = path.join(dir, 'results');
		await fs.mkdir(projectPath, { recursive: true });
		await fs.mkdir(resultsPath, { recursive: true });

		try {
			await fs.writeFile(path.join(projectPath, 'src.txt'), 'project-content');
			await fs.writeFile(path.join(resultsPath, 'summary.txt'), 'results-content');

			const transcript = {
				prompt: 'p',
				promptTokenCount: 0,
				promptCost: 0,
				messages: [],
			} as any;

			const { renderedPrompt } = await renderJudgePromptTemplate(
				'P={{PROJECT_FILE:src.txt}} R={{RESULTS_FILE:summary.txt}}',
				{
					projectPath,
					resultsPath,
					transcript,
					finalAssistantText: 'ignored',
				},
			);

			expect(renderedPrompt).toContain('project-content');
			expect(renderedPrompt).toContain('results-content');
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
