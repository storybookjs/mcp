import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRegistry } from './registry.ts';

describe('readRegistry', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(join(tmpdir(), 'sb-mcp-proxy-registry-'));
	});

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it('returns [] when the registry dir does not exist', async () => {
		const result = await readRegistry(join(dir, 'does-not-exist'));
		expect(result).toEqual([]);
	});

	it('returns [] when the registry dir is empty', async () => {
		const result = await readRegistry(dir);
		expect(result).toEqual([]);
	});

	it('parses valid records and filters dead PIDs', async () => {
		const alive = {
			pid: process.pid,
			cwd: '/tmp/alive',
			url: 'http://localhost:6006',
			mcp: { ready: true, path: '/mcp' },
		};
		const dead = {
			// 1 is init on macos/linux and we can't signal it without privileges,
			// but kill(1, 0) returns EPERM which we treat as alive. Use a huge PID
			// that will not exist as a clearly-dead process.
			pid: 2147483646,
			cwd: '/tmp/dead',
			url: 'http://localhost:6007',
			mcp: { ready: true, path: '/mcp' },
		};

		await fs.writeFile(join(dir, 'alive.json'), JSON.stringify(alive));
		await fs.writeFile(join(dir, 'dead.json'), JSON.stringify(dead));
		await fs.writeFile(join(dir, 'malformed.json'), '{ not json');
		await fs.writeFile(join(dir, 'wrong-shape.json'), JSON.stringify({ foo: 'bar' }));
		await fs.writeFile(join(dir, 'ignored.txt'), 'should be ignored');

		const result = await readRegistry(dir);
		expect(result).toEqual([alive]);
	});
});
