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

	it('parses valid records and filters dead PIDs and bad schema versions', async () => {
		const alive = {
			schemaVersion: 1,
			instanceId: 'alive-uuid',
			pid: process.pid,
			cwd: '/tmp/alive',
			url: 'http://localhost:6006',
			port: 6006,
			storybookVersion: '10.4.0',
			startedAt: '2026-05-18T12:00:00.000Z',
			updatedAt: '2026-05-18T12:00:03.000Z',
			mcp: { status: 'ready', endpoint: 'http://localhost:6006/mcp' },
		};
		const dead = {
			schemaVersion: 1,
			instanceId: 'dead-uuid',
			pid: 2147483646,
			cwd: '/tmp/dead',
			url: 'http://localhost:6007',
			port: 6007,
			mcp: { status: 'ready', endpoint: 'http://localhost:6007/mcp' },
		};
		const unknownStatus = {
			schemaVersion: 1,
			instanceId: 'bad-uuid',
			pid: process.pid,
			cwd: '/tmp/bad',
			url: 'http://localhost:6008',
			port: 6008,
			mcp: { status: 'unrecognised', endpoint: 'http://localhost:6008/mcp' },
		};

		await fs.writeFile(join(dir, 'alive.json'), JSON.stringify(alive));
		await fs.writeFile(join(dir, 'dead.json'), JSON.stringify(dead));
		await fs.writeFile(join(dir, 'bad-status.json'), JSON.stringify(unknownStatus));
		await fs.writeFile(join(dir, 'malformed.json'), '{ not json');
		await fs.writeFile(join(dir, 'wrong-shape.json'), JSON.stringify({ foo: 'bar' }));
		await fs.writeFile(join(dir, 'ignored.txt'), 'should be ignored');

		const result = await readRegistry(dir);
		expect(result).toEqual([alive]);
	});
});
