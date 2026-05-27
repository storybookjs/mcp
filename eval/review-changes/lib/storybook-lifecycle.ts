/**
 * Storybook process lifecycle for captures.
 *
 * Why this exists: a long-running Storybook dev server accumulates
 * Vite/HMR state across capture cycles. The agent's edits (revert,
 * re-edit, revert) eventually destabilise the module graph and the
 * story index endpoint starts returning 500. Symptoms we saw before
 * this helper landed:
 *   - `get-changed-stories` returns "Failed to fetch story index: 500"
 *     even for tiny, isolated edits.
 *   - The same prompt that worked yesterday fails today because the
 *     storybook process has 50+ capture cycles behind it.
 *
 * Killing and restarting Storybook between captures gives each run a
 * clean, deterministic baseline. The addon-mcp in-memory review-state
 * store is also reset for free (it lives in the storybook process).
 *
 * Trade-off: a Storybook cold-start adds ~10-30 seconds per capture.
 * Accuracy over speed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { x } from 'tinyexec';

/**
 * Storybook/Vite write colourised output (ANSI escape codes) to their
 * stdout. Persisted to a `.storybook.log` file those codes are just
 * noise — `[32m`, `[2K` and friends — that make the log painful to
 * read. This Transform strips them as the child's output streams past
 * on its way to disk. Colour sequences are short and effectively never
 * straddle a chunk boundary, so a per-chunk regex is sufficient.
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /[][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nqry=><])/g;

function stripAnsiStream(): Transform {
	return new Transform({
		transform(chunk, _enc, cb) {
			cb(null, chunk.toString('utf8').replace(ANSI_RE, ''));
		},
	});
}

export interface RestartOptions {
	/** Target repo path; storybook is spawned with this as cwd. */
	cwd: string;
	/** Full Storybook URL (port is parsed from it). */
	storybookUrl: string;
	/**
	 * Override for the spawn command. If omitted, defaults to
	 * `npx storybook dev --port <port> --no-open` — works for any
	 * project that has the `storybook` package installed locally.
	 */
	storybookCmd?: string;
	/** Where to redirect storybook's stdout+stderr during this capture. */
	logPath: string;
	/** Optional progress callback (e.g. for verbose mode). */
	onProgress?: (msg: string) => void;
	/** Max wait for /index.json to come back 200. Default 90s. */
	readyTimeoutMs?: number;
	/** Max wait for the port to free after kill. Default 30s. */
	killTimeoutMs?: number;
}

/**
 * SIGKILL the given pid, trying the process group first
 * (`process.kill(-pid)`) and falling back to the bare pid. Returns
 * true on a successful syscall, false if both attempts failed.
 *
 * We spawn Storybook with `detached: true`, which makes it a process
 * group leader. Killing just the pid leaves vite/vitest children
 * holding the port; killing the group takes the whole tree down.
 */
function hardKill(pid: number, log: (m: string) => void): boolean {
	try {
		process.kill(-pid, 'SIGKILL');
		return true;
	} catch (e) {
		// ESRCH → not a process group leader (probably an external
		// `yarn storybook`). Fall back to single-pid kill.
		try {
			process.kill(pid, 'SIGKILL');
			return true;
		} catch (e2) {
			log(`SIGKILL ${pid} failed: ${(e2 as Error).message}`);
			return false;
		}
	}
}

export interface RestartResult {
	/** PID of the new storybook process (detached; survives this CLI exiting). */
	pid?: number;
	/** Command we actually spawned. */
	spawnedCmd: string;
	/** Path to the storybook stdout/stderr log we wrote. */
	logPath: string;
	/** Time spent on the whole restart (kill + spawn + ready), in ms. */
	totalMs: number;
}

function parsePort(url: string): number {
	const port = new URL(url).port;
	if (!port) throw new Error(`Could not parse port from --storybook-url ${url}`);
	return Number(port);
}

export async function pidOnPort(port: number): Promise<number | undefined> {
	// `-sTCP:LISTEN` (ANDed via `-a`) restricts to the process *listening*
	// on the port — i.e. the Storybook dev server. Without it, `lsof`
	// also returns the client side of every open connection to the port,
	// including this CLI's own keep-alive socket from fetching
	// `/index.json` — and killing that pid's process group kills the
	// capture itself.
	const r = await x('lsof', ['-a', '-ti', `:${port}`, '-sTCP:LISTEN'], {
		nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
	});
	const first = String(r.stdout ?? '').trim().split('\n')[0];
	return first ? Number(first) : undefined;
}

/**
 * Kill a previously-spawned Storybook process. Mirrors `restartStorybook`'s
 * kill phase but is exposed so the runner can call it during teardown when
 * we want a clean state at the end of a capture (`!keepChanges`).
 *
 * Best-effort: never throws. SIGTERM first, SIGKILL after 3s if still alive.
 */
export async function killStorybook(
	port: number,
	expectedPid?: number,
	onProgress?: (msg: string) => void,
): Promise<{ killed: boolean }> {
	const log = onProgress ?? (() => undefined);
	const current = await pidOnPort(port);
	if (!current) {
		log(`port ${port} already free — nothing to kill`);
		return { killed: false };
	}
	if (expectedPid && current !== expectedPid) {
		log(
			`port ${port} now held by pid ${current} (not the pid ${expectedPid} we spawned) — killing it anyway`,
		);
	} else {
		log(`killing storybook pid ${current} on port ${port} (SIGTERM)`);
	}
	// Try group SIGTERM (we spawned with detached: true so this hits
	// vite/vitest children too); fall back to plain pid.
	try {
		process.kill(-current, 'SIGTERM');
	} catch {
		try {
			process.kill(current, 'SIGTERM');
		} catch (e) {
			log(`SIGTERM failed: ${(e as Error).message}`);
		}
	}
	await new Promise((r) => setTimeout(r, 3000));
	const stillThere = await pidOnPort(port);
	if (stillThere) {
		log(`pid ${stillThere} still alive — SIGKILL (group)`);
		hardKill(stillThere, log);
	}
	return { killed: true };
}

async function waitForReady(
	url: string,
	timeoutMs: number,
	log: (m: string) => void,
): Promise<void> {
	const indexUrl = url.replace(/\/$/, '') + '/index.json';
	const deadline = Date.now() + timeoutMs;
	let lastErr = '';
	while (Date.now() < deadline) {
		try {
			const res = await fetch(indexUrl);
			if (res.ok) return;
			lastErr = `HTTP ${res.status} ${res.statusText}`;
		} catch (e) {
			lastErr = (e as Error).message;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(
		`Storybook did not become ready at ${indexUrl} within ${timeoutMs}ms (last response: ${lastErr})`,
	);
}

function defaultSpawnCmd(port: number): string {
	return `npx storybook dev --port ${port} --no-open`;
}

export async function restartStorybook(options: RestartOptions): Promise<RestartResult> {
	const t0 = Date.now();
	const port = parsePort(options.storybookUrl);
	const log = options.onProgress ?? (() => undefined);
	const readyTimeoutMs = options.readyTimeoutMs ?? 90_000;
	const killTimeoutMs = options.killTimeoutMs ?? 30_000;

	// 1. Kill whatever is on the port, if anything.
	//
	// Storybook 10.5+ dev server spawns vite/vitest workers as
	// children. Naive `process.kill(parent, 'SIGKILL')` leaves the
	// children holding the port. We:
	//   - SIGTERM the process group first (graceful, lets vite close
	//     watchers / sockets)
	//   - poll lsof; if the port is still held after 3s, SIGKILL the
	//     CURRENT holder (which may be a child that re-bound, not the
	//     original parent) — repeated each loop until free
	const existing = await pidOnPort(port);
	if (existing) {
		log(`port ${port} in use by pid ${existing} — SIGTERM (group)`);
		try {
			process.kill(-existing, 'SIGTERM');
		} catch {
			try {
				process.kill(existing, 'SIGTERM');
			} catch (e) {
				log(`SIGTERM failed: ${(e as Error).message} (process may already be gone)`);
			}
		}
		await new Promise((r) => setTimeout(r, 3000));

		const deadline = Date.now() + killTimeoutMs;
		while (Date.now() < deadline) {
			const holder = await pidOnPort(port);
			if (!holder) break;
			log(`port ${port} still held by pid ${holder} — SIGKILL (group)`);
			hardKill(holder, log);
			await new Promise((r) => setTimeout(r, 500));
		}
		const finalHolder = await pidOnPort(port);
		if (finalHolder) {
			throw new Error(
				`Port ${port} still held by pid ${finalHolder} after ${killTimeoutMs}ms of SIGKILL — try \`lsof -i :${port}\` and kill manually`,
			);
		}
		log(`port ${port} free`);
	} else {
		log(`port ${port} already free — no existing storybook to kill`);
	}

	// 2. Spawn fresh storybook, detached so it outlives this CLI.
	const cmd = options.storybookCmd ?? defaultSpawnCmd(port);
	log(`spawning: ${cmd}  (cwd=${options.cwd})`);
	await fs.mkdir(path.dirname(options.logPath), { recursive: true });
	const logStream = createWriteStream(options.logPath, { flags: 'w' });
	logStream.write(`# storybook log — started ${new Date().toISOString()}\n`);
	logStream.write(`# spawn: ${cmd}\n`);
	logStream.write(`# cwd:   ${options.cwd}\n\n`);

	const [bin, ...args] = cmd.split(/\s+/);
	const child: ChildProcess = spawn(bin!, args, {
		cwd: options.cwd,
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, BROWSER: 'none', CI: '1' },
	});
	// Strip ANSI colour codes on the way to disk so the log is readable.
	child.stdout?.pipe(stripAnsiStream()).pipe(logStream, { end: false });
	child.stderr?.pipe(stripAnsiStream()).pipe(logStream, { end: false });
	child.unref();

	// 3. Wait for /index.json to return 200.
	log(`waiting for ${options.storybookUrl}/index.json (up to ${Math.round(readyTimeoutMs / 1000)}s)`);
	try {
		await waitForReady(options.storybookUrl, readyTimeoutMs, log);
	} catch (e) {
		throw new Error(
			`${(e as Error).message}\n  storybook stdout/stderr → ${options.logPath}`,
		);
	}
	log(`storybook ready (pid=${child.pid})`);

	return {
		pid: child.pid,
		spawnedCmd: cmd,
		logPath: options.logPath,
		totalMs: Date.now() - t0,
	};
}

/**
 * Best-effort: delete `/tmp/review-mcp-config-*.json` files older than
 * `maxAgeMs`. These accumulate one per capture and are only useful for
 * post-mortem on the most recent runs.
 */
export async function cleanOldMcpConfigs(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
	const tmp = '/tmp';
	let removed = 0;
	try {
		const entries = await fs.readdir(tmp);
		const cutoff = Date.now() - maxAgeMs;
		for (const name of entries) {
			if (!/^review-mcp-config-\d+\.json$/.test(name)) continue;
			const full = path.join(tmp, name);
			try {
				const stat = await fs.stat(full);
				if (stat.mtimeMs < cutoff) {
					await fs.unlink(full);
					removed++;
				}
			} catch {
				// best-effort
			}
		}
	} catch {
		// /tmp readdir failed — fine, nothing to clean
	}
	return removed;
}

