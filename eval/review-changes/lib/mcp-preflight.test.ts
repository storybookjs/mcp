import { describe, expect, it } from 'vitest';
import { preflightMcp, formatPreflightFailure } from './mcp-preflight.ts';

/**
 * Build a fake `fetch` that returns an MCP `tools/list` SSE response with
 * the given tools — enough to drive `preflightMcp` without a real server.
 */
function fakeFetch(tools: unknown[]): typeof fetch {
	return (async () => {
		const body = `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools } })}\n`;
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			text: async () => body,
		} as Response;
	}) as typeof fetch;
}

const getChangedStories = { name: 'get-changed-stories', inputSchema: { type: 'object', properties: {} } };

const newApplyReviewState = {
	name: 'display-review',
	inputSchema: {
		type: 'object',
		properties: { title: {}, description: {}, collections: {}, changedFiles: {}, diffHunks: {} },
		required: ['title', 'description', 'collections'],
	},
};

// The pre-rename shape addon-mcp 0.6.0 shipped.
const oldApplyReviewState = {
	name: 'display-review',
	inputSchema: {
		type: 'object',
		properties: { narrative: {}, clusters: {}, changedFiles: {}, diffHunks: {} },
		required: ['narrative', 'clusters'],
	},
};

describe('preflightMcp schema-skew detection', () => {
	it('passes when display-review advertises the current title/description/collections shape', async () => {
		const result = await preflightMcp(
			'http://localhost:6010',
			fakeFetch([getChangedStories, newApplyReviewState]),
		);
		expect(result.ok).toBe(true);
	});

	it('fails with stage "schema-skew" when the target advertises the old narrative/clusters shape', async () => {
		const result = await preflightMcp(
			'http://localhost:6010',
			fakeFetch([getChangedStories, oldApplyReviewState]),
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure');
		expect(result.stage).toBe('schema-skew');
		expect(result.missing).toEqual(['title', 'description', 'collections']);
		const formatted = formatPreflightFailure(result);
		expect(formatted).toContain('stale');
		expect(formatted).toContain('link-addon-mcp');
	});

	it('still flags missing required tools before reaching the schema check', async () => {
		const result = await preflightMcp('http://localhost:6010', fakeFetch([newApplyReviewState]));
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure');
		expect(result.stage).toBe('missing-tools');
	});
});
