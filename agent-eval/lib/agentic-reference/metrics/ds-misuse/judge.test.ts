import { afterEach, describe, expect, it, vi } from 'vitest';

const FINAL_MESSAGE = vi.fn();
const STREAM = vi.fn(() => ({ finalMessage: FINAL_MESSAGE }));

vi.mock('@anthropic-ai/sdk', () => ({
	default: class {
		messages = { stream: STREAM };
	},
}));

import { runJudge, type JudgeRequest } from './judge.ts';

const REQUEST = {
	model: 'claude-opus-4-8',
	max_tokens: 32_000,
	system: [],
	messages: [],
} as unknown as JudgeRequest;

afterEach(() => {
	vi.clearAllMocks();
	delete process.env.ANTHROPIC_API_KEY;
});

describe('runJudge', () => {
	it('returns the parsed nodes from the structured response', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-test';
		// A complete DS node: output_config.format requires both DS answers on one,
		// so a fixture without them is a shape the API would never return.
		const node = {
			path: 'App/A[0]',
			file: 'a.tsx',
			line: 1,
			tag: 'A',
			kind: 'ds',
			correctDsDecision: { score: 1, reason: 'right component' },
			correctDsUsage: { score: 0.5, reason: 'debatable variant' },
		};
		FINAL_MESSAGE.mockResolvedValue({
			stop_reason: 'end_turn',
			content: [{ type: 'text', text: JSON.stringify({ nodes: [node] }) }],
		});
		await expect(runJudge(REQUEST)).resolves.toEqual({ nodes: [node] });
	});

	// A refusal returns HTTP 200 with no usable content. Reading content[0] blindly
	// would surface as a confusing parse error three frames away from the cause.
	it('names a refusal rather than failing to parse it', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-test';
		FINAL_MESSAGE.mockResolvedValue({ stop_reason: 'refusal', stop_details: null, content: [] });
		await expect(runJudge(REQUEST)).rejects.toThrow(/refused/i);
	});

	it('names a truncated response rather than parsing half of it', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-test';
		FINAL_MESSAGE.mockResolvedValue({
			stop_reason: 'max_tokens',
			content: [{ type: 'text', text: '{"nodes":[' }],
		});
		await expect(runJudge(REQUEST)).rejects.toThrow(/max_tokens/);
	});
});

describe('assertApiKey', () => {
	it('names the variable and where to set it', async () => {
		const { assertApiKey } = await import('./judge.ts');
		expect(() => assertApiKey()).toThrow(/ANTHROPIC_API_KEY/);
		expect(() => assertApiKey()).toThrow(/\.env\.local/);
	});
});
