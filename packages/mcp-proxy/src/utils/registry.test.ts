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

	it('returns an empty result when the registry dir does not exist', async () => {
		const result = await readRegistry(join(dir, 'does-not-exist'));
		expect(result).toEqual({ records: [], errors: [] });
	});

	it('returns an empty result when the registry dir is empty', async () => {
		const result = await readRegistry(dir);
		expect(result).toEqual({ records: [], errors: [] });
	});

	it('parses valid v1 records and silently drops dead pids + buggy v1 records that fail validation', async () => {
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
		const buggyV1 = {
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
		await fs.writeFile(join(dir, 'buggy-v1.json'), JSON.stringify(buggyV1));
		await fs.writeFile(join(dir, 'ignored.txt'), 'should be ignored');

		const result = await readRegistry(dir);
		expect(result).toEqual({ records: [alive], errors: [] });
	});

	it('emits per-cwd errors for future-version records with an extractable cwd, gated on liveness', async () => {
		const v1Alive = {
			schemaVersion: 1,
			instanceId: 'v1',
			pid: process.pid,
			cwd: '/tmp/v1',
			url: 'http://localhost:6006',
			port: 6006,
			mcp: { status: 'ready', endpoint: 'http://localhost:6006/mcp' },
		};
		const v2AliveA = { schemaVersion: 2, pid: process.pid, cwd: '/tmp/a' };
		const v2AliveB = { schemaVersion: 2, pid: process.pid, cwd: '/tmp/b' };
		const v3Alive = { schemaVersion: 3, pid: process.pid, cwd: '/tmp/a' };
		const v2Dead = { schemaVersion: 2, pid: 2147483646, cwd: '/tmp/a' };
		const v2NoCwd = { schemaVersion: 2, pid: process.pid };

		await fs.writeFile(join(dir, 'v1.json'), JSON.stringify(v1Alive));
		await fs.writeFile(join(dir, 'v2-a.json'), JSON.stringify(v2AliveA));
		await fs.writeFile(join(dir, 'v2-b.json'), JSON.stringify(v2AliveB));
		await fs.writeFile(join(dir, 'v3-a.json'), JSON.stringify(v3Alive));
		await fs.writeFile(join(dir, 'v2-dead.json'), JSON.stringify(v2Dead));
		await fs.writeFile(join(dir, 'v2-no-cwd.json'), JSON.stringify(v2NoCwd));

		const result = await readRegistry(dir);
		expect(result.records).toEqual([v1Alive]);
		expect(result.errors).toStrictEqual([
			{ kind: 'unsupported-schema', cwd: '/tmp/a', schemaVersion: 2 },
			{ kind: 'unsupported-schema', cwd: '/tmp/b', schemaVersion: 2 },
			{ kind: 'unsupported-schema', cwd: '/tmp/a', schemaVersion: 3 },
		]);
		expect(result.errors).toHaveLength(3);
	});

	it('emits per-cwd unparseable errors for JSON records with a cwd but no usable schemaVersion', async () => {
		await fs.writeFile(join(dir, 'no-version.json'), JSON.stringify({ cwd: '/tmp/a', foo: 'bar' }));
		await fs.writeFile(
			join(dir, 'string-version.json'),
			JSON.stringify({ cwd: '/tmp/b', schemaVersion: '1' }),
		);
		await fs.writeFile(
			join(dir, 'negative-version.json'),
			JSON.stringify({ cwd: '/tmp/c', schemaVersion: -1 }),
		);

		const result = await readRegistry(dir);
		expect(result.records).toEqual([]);
		expect(result.errors).toEqual(
			expect.arrayContaining([
				{ kind: 'unparseable', cwd: '/tmp/a' },
				{ kind: 'unparseable', cwd: '/tmp/b' },
				{ kind: 'unparseable', cwd: '/tmp/c' },
			]),
		);
		expect(result.errors).toHaveLength(3);
	});

	it('silently drops errors that cannot be tied to a cwd', async () => {
		await fs.writeFile(join(dir, 'bad-json.json'), '{ not json');
		await fs.writeFile(join(dir, 'array.json'), JSON.stringify([1, 2, 3]));
		await fs.writeFile(join(dir, 'no-cwd.json'), JSON.stringify({ foo: 'bar' }));
		await fs.writeFile(join(dir, 'v2-no-cwd.json'), JSON.stringify({ schemaVersion: 2 }));

		const result = await readRegistry(dir);
		expect(result).toEqual({ records: [], errors: [] });
	});
});
