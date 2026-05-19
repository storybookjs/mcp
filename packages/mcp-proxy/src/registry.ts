import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { StorybookInstanceRecord } from './types.ts';

export const DEFAULT_REGISTRY_DIR = join(homedir(), '.storybook');

/**
 * Errno codes for which we degrade to "no instance" rather than throwing.
 * The proxy is meant to fail-soft for environmental issues; a noisy stack
 * trace on every tool call would be worse UX than the missing-instance
 * intercept.
 */
const SOFT_REGISTRY_ERRORS = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR']);

/**
 * Read all Storybook instance records from `registryDir`.
 *
 * Each file is expected to be a single JSON object matching
 * {@link StorybookInstanceRecord}. Records whose PID is no longer alive are
 * filtered out. Malformed files are skipped silently — the proxy should
 * degrade to "no instance" rather than fail loudly.
 *
 * NOTE: Storybook-core does not write these files yet. Until that lands, this
 * function returns an empty list in the common case, which causes the proxy to
 * surface the "no instance" intercept on every call. That is intentional v0
 * behaviour.
 */
export async function readRegistry(
	registryDir: string = DEFAULT_REGISTRY_DIR,
): Promise<StorybookInstanceRecord[]> {
	let entries: string[];
	try {
		entries = await fs.readdir(registryDir);
	} catch (error) {
		if (SOFT_REGISTRY_ERRORS.has((error as NodeJS.ErrnoException).code ?? '')) {
			return [];
		}
		throw error;
	}

	const records = await Promise.all(
		entries
			.filter((name) => name.endsWith('.json'))
			.map(async (name) => {
				try {
					const raw = await fs.readFile(join(registryDir, name), 'utf-8');
					const parsed = JSON.parse(raw) as StorybookInstanceRecord;
					if (!isRecord(parsed)) {
						return null;
					}
					if (!isProcessAlive(parsed.pid)) {
						return null;
					}
					return parsed;
				} catch {
					return null;
				}
			}),
	);

	return records.filter((r): r is StorybookInstanceRecord => r !== null);
}

function isRecord(value: unknown): value is StorybookInstanceRecord {
	if (!value || typeof value !== 'object') return false;
	const r = value as Partial<StorybookInstanceRecord>;
	return (
		typeof r.pid === 'number' &&
		typeof r.cwd === 'string' &&
		typeof r.url === 'string' &&
		!!r.mcp &&
		typeof r.mcp.ready === 'boolean' &&
		typeof r.mcp.path === 'string'
	);
}

/**
 * Liveness check by sending signal 0. `EPERM` means the PID exists but we
 * lack permission to signal it (foreign user), which still counts as alive.
 */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}
