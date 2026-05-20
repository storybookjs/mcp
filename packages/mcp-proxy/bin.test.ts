import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StdioTransport } from '@tmcp/transport-stdio';

describe('bin', () => {
	let originalArgv: string[];

	beforeEach(() => {
		originalArgv = process.argv;
		process.argv = ['node', 'bin.ts'];
		vi.resetModules();
	});

	afterEach(() => {
		process.argv = originalArgv;
		vi.restoreAllMocks();
	});

	it('starts an stdio transport for the proxy server', async () => {
		const listenSpy = vi
			.spyOn(StdioTransport.prototype, 'listen')
			.mockImplementation(() => {});

		await import('./bin.ts');

		expect(listenSpy).toHaveBeenCalledOnce();
	});
});
