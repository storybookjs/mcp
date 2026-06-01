import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as v from 'valibot';
import { StorybookInstanceRecordV1Schema, type StorybookInstanceRecordV1 } from '../types/index.ts';

export const DEFAULT_REGISTRY_DIR = join(homedir(), '.storybook', 'instances');

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
 * {@link StorybookInstanceRecordV1}. Records whose PID is no longer alive are
 * filtered out (stale removal per milestone 2). Malformed files are skipped
 * silently — the proxy should degrade to "no instance" rather than fail loudly.
 */
export async function readRegistry(
	registryDir: string = DEFAULT_REGISTRY_DIR,
): Promise<StorybookInstanceRecordV1[]> {
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
					const parsed = v.safeParse(StorybookInstanceRecordV1Schema, JSON.parse(raw));
					if (!parsed.success) return null;
					if (!isProcessAlive(parsed.output.pid)) {
						clearRegistry(join(registryDir, name)).catch(() => {
							/* ignore cleanup errors */
						});
						return null;
					}
					return parsed.output;
				} catch {
					return null;
				}
			}),
	);

	return records.filter((r): r is StorybookInstanceRecordV1 => r !== null);
}

/**
 * Liveness check by sending signal 0. `EPERM` means the PID exists but we
 * lack permission to signal it (foreign user), which still counts as alive.
 */
function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

function clearRegistry(path: string) {
	return fs.rm(path, { recursive: true, force: true });
}
