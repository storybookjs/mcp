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

	it('drops records whose mcp.endpoint is not loopback', async () => {
		const base = {
			schemaVersion: 1,
			pid: process.pid,
			cwd: '/tmp/x',
			url: 'http://localhost:6006',
			port: 6006,
		};
		await fs.writeFile(
			join(dir, 'remote.json'),
			JSON.stringify({
				...base,
				instanceId: 'remote',
				mcp: { status: 'ready', endpoint: 'http://attacker.test/mcp' },
			}),
		);
		await fs.writeFile(
			join(dir, 'lan.json'),
			JSON.stringify({
				...base,
				instanceId: 'lan',
				mcp: { status: 'ready', endpoint: 'http://10.0.0.5:6006/mcp' },
			}),
		);
		await fs.writeFile(
			join(dir, 'malformed-endpoint.json'),
			JSON.stringify({
				...base,
				instanceId: 'bad-url',
				mcp: { status: 'ready', endpoint: 'not a url' },
			}),
		);
		await fs.writeFile(
			join(dir, 'loopback.json'),
			JSON.stringify({
				...base,
				instanceId: 'loopback',
				mcp: { status: 'ready', endpoint: 'http://127.0.0.1:6006/mcp' },
			}),
		);
		await fs.writeFile(
			join(dir, 'no-endpoint.json'),
			JSON.stringify({
				...base,
				instanceId: 'starting',
				mcp: { status: 'starting' },
			}),
		);

		const result = await readRegistry(dir);
		const ids = result.map((r) => r.instanceId).sort();
		expect(ids).toEqual(['loopback', 'starting']);
	});

	it('filters records with non-positive PIDs (process-group sentinels)', async () => {
		const base = {
			schemaVersion: 1,
			cwd: '/tmp/x',
			url: 'http://localhost:6006',
			port: 6006,
			mcp: { status: 'ready', endpoint: 'http://localhost:6006/mcp' },
		};
		await fs.writeFile(
			join(dir, 'zero.json'),
			JSON.stringify({ ...base, instanceId: 'zero', pid: 0 }),
		);
		await fs.writeFile(
			join(dir, 'negative.json'),
			JSON.stringify({ ...base, instanceId: 'neg', pid: -1 }),
		);

		const result = await readRegistry(dir);
		expect(result).toEqual([]);
	});
});
