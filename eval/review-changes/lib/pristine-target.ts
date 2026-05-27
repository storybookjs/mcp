/**
 * Make a target repo pristine before a capture.
 *
 * The teardown (`git checkout -- . && git clean -fd`) only restores
 * *tracked* files. `node_modules` is gitignored, so a previous run that
 * had the agent add or remove a dependency leaves `node_modules` out of
 * sync with the now-restored `package.json` / lockfile — e.g. a
 * styled-components → emotion migration leaves `node_modules` without
 * styled-components even though `package.json` lists it again. The next
 * run then builds against a broken dependency tree and the failure
 * looks like an agent mistake when it isn't.
 *
 * Storybook's / Vite's on-disk caches under `node_modules/.cache` and
 * `node_modules/.vite` are the same hazard: a cache primed by a
 * previous run's code can serve stale modules into this one.
 *
 * `restorePristineTarget` fixes both — wipe the build caches, then run
 * the package manager's install so `node_modules` matches the committed
 * lockfile exactly.
 */
import { x } from 'tinyexec';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Build caches that must not survive between runs. */
const CACHE_DIRS = ['node_modules/.cache', 'node_modules/.vite'];

/**
 * Pick the install command from whatever lockfile the target ships.
 * Each command reconciles `node_modules` to the committed lockfile
 * *without* rewriting the lockfile (so a capture never mutates tracked
 * files): `--immutable` / `--frozen-lockfile` / `npm ci`.
 */
async function detectInstallCmd(cwd: string): Promise<string | undefined> {
	const has = (f: string) =>
		fs
			.access(path.join(cwd, f))
			.then(() => true)
			.catch(() => false);
	if (await has('yarn.lock')) {
		// Berry (yarn 2+) ships a `.yarnrc.yml`; classic yarn does not.
		return (await has('.yarnrc.yml'))
			? 'yarn install --immutable'
			: 'yarn install --frozen-lockfile';
	}
	if (await has('pnpm-lock.yaml')) return 'pnpm install --frozen-lockfile';
	if (await has('package-lock.json')) return 'npm ci';
	if (await has('bun.lockb')) return 'bun install --frozen-lockfile';
	return undefined;
}

export interface PristineResult {
	cachesCleared: string[];
	installCmd?: string;
	installMs: number;
	skippedInstall: boolean;
}

export async function restorePristineTarget(opts: {
	cwd: string;
	/** Override the auto-detected install command. */
	installCmd?: string;
	/** Skip the dependency reconcile (caches are still cleared). */
	skipInstall?: boolean;
	onProgress?: (msg: string) => void;
}): Promise<PristineResult> {
	const log = opts.onProgress ?? (() => undefined);

	// 1. Wipe Storybook / Vite build caches.
	const cleared: string[] = [];
	for (const rel of CACHE_DIRS) {
		try {
			await fs.rm(path.join(opts.cwd, rel), { recursive: true, force: true });
			cleared.push(rel);
			log(`cleared ${rel}`);
		} catch {
			// best-effort — a missing cache dir is the happy path
		}
	}

	if (opts.skipInstall) {
		log('skipping dependency reconcile (--skip-install)');
		return { cachesCleared: cleared, installMs: 0, skippedInstall: true };
	}

	// 2. Reconcile node_modules with the committed lockfile.
	const cmd = opts.installCmd ?? (await detectInstallCmd(opts.cwd));
	if (!cmd) {
		log('no lockfile detected and no --install-cmd given — skipping dependency reconcile');
		return { cachesCleared: cleared, installMs: 0, skippedInstall: true };
	}
	log(`reconciling dependencies: ${cmd}`);
	const t0 = Date.now();
	const run = async (c: string) => {
		const [bin, ...args] = c.split(/\s+/);
		const r = await x(bin!, args, {
			nodeOptions: { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] },
		});
		return {
			exitCode: r.exitCode ?? 1,
			output: `${String(r.stdout ?? '')}\n${String(r.stderr ?? '')}`.trim(),
		};
	};

	let result = await run(cmd);
	let effectiveCmd = cmd;

	// A target that consumes locally-packed `file:` tarballs (this harness's
	// own @storybook/addon-mcp + @storybook/mcp, installed by link-addon-mcp)
	// records the tarball's *content hash* in yarn.lock. Every repack changes
	// that hash, so the committed lockfile is stale-by-design and `yarn
	// install --immutable` refuses with YN0028 "the lockfile would have been
	// modified". Benign here: fall back to a mutable install to reconcile
	// node_modules, then restore the committed lockfile so the post-run
	// `git diff HEAD` stays free of this setup-only churn.
	if (
		result.exitCode !== 0 &&
		cmd.includes('--immutable') &&
		/lockfile would have been modified|YN0028/.test(result.output)
	) {
		effectiveCmd = cmd.replace(/\s*--immutable\b/, '').trim();
		log(`immutable install rejected a stale lockfile (volatile file: deps) — retrying: ${effectiveCmd}`);
		result = await run(effectiveCmd);
		if (result.exitCode === 0) {
			try {
				await x('git', ['-C', opts.cwd, 'checkout', '--', 'yarn.lock'], {
					nodeOptions: { stdio: 'pipe' },
				});
			} catch {
				// best-effort — a lingering lockfile diff is caught by capture's
				// post-run diff, not worth failing the reconcile over
			}
			log('restored committed yarn.lock (node_modules already reconciled)');
		}
	}

	const installMs = Date.now() - t0;
	if (result.exitCode !== 0) {
		throw new Error(
			`Dependency reconcile failed (\`${effectiveCmd}\` exited ${result.exitCode}):\n` +
				result.output.slice(0, 800),
		);
	}
	log(`dependencies reconciled in ${(installMs / 1000).toFixed(1)}s`);
	return { cachesCleared: cleared, installCmd: effectiveCmd, installMs, skippedInstall: false };
}
