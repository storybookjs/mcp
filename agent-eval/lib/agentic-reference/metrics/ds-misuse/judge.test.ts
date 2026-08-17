import { afterEach, describe, expect, it, vi } from 'vitest';

const FINAL_MESSAGE = vi.fn();
const STREAM = vi.fn(() => ({ finalMessage: FINAL_MESSAGE }));

vi.mock('@anthropic-ai/sdk', () => ({
	default: class {
		messages = { stream: STREAM };
	},
}));

import { isAccountFailure, runJudge, type JudgeRequest } from './judge.ts';

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
			usage: {
				input_tokens: 12,
				cache_creation_input_tokens: 34,
				cache_read_input_tokens: 56,
				output_tokens: 78,
			},
		});
		await expect(runJudge(REQUEST)).resolves.toEqual({
			response: { nodes: [node] },
			usage: { input: 12, cacheWrite: 34, cacheRead: 56, output: 78 },
		});
	});

	// The cache fields are absent rather than zero on a response that used no
	// caching, and a missing count must read as none rather than as NaN — the
	// whole point of recording them is to tell a cache read from a rewrite.
	it('reads absent cache counts as zero', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-test';
		FINAL_MESSAGE.mockResolvedValue({
			stop_reason: 'end_turn',
			content: [{ type: 'text', text: '{"nodes":[]}' }],
			usage: { input_tokens: 5, output_tokens: 7 },
		});
		await expect(runJudge(REQUEST)).resolves.toEqual({
			response: { nodes: [] },
			usage: { input: 5, cacheWrite: 0, cacheRead: 0, output: 7 },
		});
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

describe('isAccountFailure', () => {
	it.each([
		'ds-misuse: ANTHROPIC_API_KEY is not set, and the judge cannot run without it.',
		'400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
		'401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
		'403 {"type":"error","error":{"type":"permission_error","message":"not allowed"}}',
	])('stops the sweep on %s', (message) => {
		expect(isAccountFailure(message)).toBe(true);
	});

	// These are failures of one run. Treating them as account failures would
	// abandon every run after the first awkward diff.
	it.each([
		'ds-misuse: the judge hit max_tokens and returned incomplete JSON.',
		'ds-misuse: the judge refused this request (no category).',
		'529 {"type":"error","error":{"type":"overloaded_error"}}',
	])('keeps going on %s', (message) => {
		expect(isAccountFailure(message)).toBe(false);
	});
});

describe('assertApiKey', () => {
	it('names the variable and where to set it', async () => {
		const { assertApiKey } = await import('./judge.ts');
		expect(() => assertApiKey()).toThrow(/ANTHROPIC_API_KEY/);
		expect(() => assertApiKey()).toThrow(/\.env\.local/);
	});
});
