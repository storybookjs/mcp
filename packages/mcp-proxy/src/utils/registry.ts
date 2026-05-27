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
 * A registry file the proxy could not turn into a usable v1 record but that
 * we *can* tie to a specific `cwd`. The proxy-tool layer compares each
 * anomaly's `cwd` against the cwd of the tool call and only warns the agent
 * when the anomaly affects the project the agent is actually working in.
 *
 * Records the proxy cannot tie to a cwd (bad JSON, JSON without a `cwd`
 * field, etc.) are silently dropped — they can't be scoped to a project, so
 * surfacing them globally would just be noise.
 */
export type RegistryError =
	| { kind: 'unsupported-schema'; cwd: string; schemaVersion: number }
	| { kind: 'unparseable'; cwd: string };

export type ReadRegistryResult = {
	records: StorybookInstanceRecordV1[];
	errors: RegistryError[];
};

/**
 * Per-file result. `drop` covers everything we discard without telling the
 * agent: read failures, dead processes, and records we can't tie to a `cwd`.
 */
type FileOutcome =
	| { kind: 'record'; record: StorybookInstanceRecordV1 }
	| { kind: 'error'; error: RegistryError }
	| { kind: 'drop' };

/**
 * Read all Storybook instance records from `registryDir`.
 *
 * Returns alive v1 records plus a list of per-record anomalies the proxy
 * could not interpret but could tie to a `cwd`: either records with a
 * schema version newer than the proxy supports, or other JSON objects with
 * a usable `cwd` that still could not be interpreted as a supported record.
 * Each anomaly carries its `cwd` so the caller can decide whether the
 * warning applies to the cwd the agent is targeting.
 */
export async function readRegistry(
	registryDir: string = DEFAULT_REGISTRY_DIR,
): Promise<ReadRegistryResult> {
	let entries: string[];
	try {
		entries = await fs.readdir(registryDir);
	} catch (error) {
		if (SOFT_REGISTRY_ERRORS.has((error as NodeJS.ErrnoException).code ?? '')) {
			return { records: [], errors: [] };
		}
		throw error;
	}

	const outcomes = await Promise.all(
		entries
			.filter((name) => name.endsWith('.json'))
			.map((name) => classify(join(registryDir, name))),
	);

	const records: StorybookInstanceRecordV1[] = [];
	const anomalies: RegistryError[] = [];
	for (const outcome of outcomes) {
		if (outcome.kind === 'record') records.push(outcome.record);
		else if (outcome.kind === 'error') anomalies.push(outcome.error);
	}

	return { records, errors: anomalies };
}

async function classify(filePath: string): Promise<FileOutcome> {
	let raw: string;
	try {
		raw = await fs.readFile(filePath, 'utf-8');
	} catch {
		return { kind: 'drop' };
	}

	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return { kind: 'drop' };
	}
	if (typeof json !== 'object' || json === null) return { kind: 'drop' };

	const obj = json as { schemaVersion?: unknown; cwd?: unknown; pid?: unknown; };
	const cwd = typeof obj.cwd === 'string' && obj.cwd.length ? obj.cwd : null;
	const schemaVersion = obj.schemaVersion;

	if (schemaVersion === 1) {
		const parsed = v.safeParse(StorybookInstanceRecordV1Schema, json);
		// A v1 record that fails strict validation is almost certainly a buggy
		// writer (Storybook should bump the version when the shape changes), so
		// drop it rather than nag the agent about a proxy upgrade it can't fix.
		if (!parsed.success) return { kind: 'drop' };
		if (!isProcessAlive(parsed.output.pid)) {
			clearRegistry(filePath).catch(() => {
				/* ignore cleanup errors */
			});
			return { kind: 'drop' };
		}
		return { kind: 'record', record: parsed.output };
	}

	// Beyond v1 we can't parse the record, so we can only warn when it's tied
	// to a cwd the agent might be targeting; otherwise drop it as noise.
	if (cwd === null) return { kind: 'drop' };

	if (typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) && schemaVersion > 1) {
		if (typeof obj.pid === 'number' && !isProcessAlive(obj.pid)) {
			clearRegistry(filePath).catch(() => {
				/* ignore cleanup errors */
			});
			return { kind: 'drop' };
		}
		return { kind: 'error', error: { kind: 'unsupported-schema', cwd, schemaVersion } };
	}

	return { kind: 'error', error: { kind: 'unparseable', cwd } };
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
