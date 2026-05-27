/**
 * Install + symlink @storybook/addon-mcp (and its workspace sibling
 * @storybook/mcp) from THIS branch into a target repo's node_modules.
 *
 * Why: the recorder needs a live `get-changed-stories` MCP call to get
 * precise cascade data (the offline import-graph walker can miss
 * runtime-resolved deps like styled-components themes). We want the
 * target repo to run its OWN Storybook (so peer-deps match) but use
 * THIS branch's addon-mcp source (so prompt/tool changes are tested).
 *
 * Strategy:
 *   1. `pnpm pack` both packages from this monorepo — this rewrites
 *      `workspace:*` and `catalog:` to concrete versions.
 *   2. `yarn add` (or `npm install`) the tarballs in the target repo.
 *      That gives a working install with proper peer-dep resolution.
 *   3. After install, replace `node_modules/@storybook/addon-mcp/dist/`
 *      with a symlink to this monorepo's `packages/addon-mcp/dist/` so
 *      iterating on the source in our branch + `pnpm build` is enough
 *      to update the target's installed copy.
 *
 * Idempotent — run again to re-pack if you've bumped versions or changed
 * the dependency set.
 */
import { x } from 'tinyexec';
import fs from 'node:fs/promises';
import path from 'node:path';
import { linkStorybookMonorepo, type LinkResult as StorybookLinkResult } from './link-storybook-monorepo.ts';

export interface LinkAddonMcpOptions {
	/** Absolute path to this monorepo's root. */
	monorepoRoot: string;
	/** Absolute path to the target repo. */
	targetRepo: string;
	/** Where to drop the temp tarballs. Defaults to /tmp/addon-mcp-pack. */
	packDir?: string;
	/** Package manager used by the target. Auto-detected from packageManager. */
	packageManager?: 'yarn' | 'npm' | 'pnpm';
	/**
	 * Absolute path to the Storybook monorepo (the one containing `code/core`).
	 * When provided, after the addon-mcp install we mirror its built packages
	 * into the target's node_modules so the target's Storybook gets 10.4+
	 * change-detection without bumping its own deps.
	 */
	storybookRepo?: string;
}

export interface MainTsStatus {
	mainPath: string | null;
	addonMcpRegistered: boolean;
	changeDetectionEnabled: boolean;
	addonReviewRegistered: boolean;
}

/**
 * Inspect the target's `.storybook/main.{ts,js,mjs,cjs}` for the three things
 * a working `display-review` loop needs:
 *   1. `@storybook/addon-mcp` listed in `addons`
 *   2. `features.changeDetection: true`
 *   3. `@storybook/addon-review` listed in `addons` (to render the
 *      `/review/` page that consumes the pushed payload)
 *
 * String-based — cheap and good enough for a status report. False negatives
 * are fine: the report says "(not done)", the user sees the snippet, done.
 */
export async function inspectStorybookMain(targetRepo: string): Promise<MainTsStatus> {
	const candidates = ['main.ts', 'main.js', 'main.mjs', 'main.cjs'];
	let mainPath: string | null = null;
	let contents = '';
	for (const name of candidates) {
		const p = path.join(targetRepo, '.storybook', name);
		try {
			contents = await fs.readFile(p, 'utf-8');
			mainPath = p;
			break;
		} catch {
			// next
		}
	}
	if (!mainPath) {
		return {
			mainPath: null,
			addonMcpRegistered: false,
			changeDetectionEnabled: false,
			addonReviewRegistered: false,
		};
	}
	return {
		mainPath,
		addonMcpRegistered: /['"]@storybook\/addon-mcp['"]/.test(contents),
		changeDetectionEnabled: /changeDetection\s*:\s*true/.test(contents),
		addonReviewRegistered: /['"]@storybook\/addon-review['"]/.test(contents),
	};
}

async function detectPackageManager(targetRepo: string): Promise<'yarn' | 'npm' | 'pnpm'> {
	try {
		const pkg = JSON.parse(await fs.readFile(path.join(targetRepo, 'package.json'), 'utf-8'));
		const pm = (pkg.packageManager ?? '').toLowerCase();
		if (pm.startsWith('yarn')) return 'yarn';
		if (pm.startsWith('pnpm')) return 'pnpm';
		if (pm.startsWith('npm')) return 'npm';
	} catch {
		// fall through
	}
	for (const [file, mgr] of [
		['yarn.lock', 'yarn'],
		['pnpm-lock.yaml', 'pnpm'],
		['package-lock.json', 'npm'],
	] as const) {
		try {
			await fs.access(path.join(targetRepo, file));
			return mgr;
		} catch {}
	}
	return 'npm';
}

async function pack(monorepoRoot: string, packageFilter: string, packDir: string): Promise<string> {
	await fs.mkdir(packDir, { recursive: true });
	const r = await x(
		'pnpm',
		['--filter', packageFilter, 'pack', '--pack-destination', packDir],
		{ nodeOptions: { cwd: monorepoRoot, stdio: ['ignore', 'pipe', 'pipe'] } },
	);
	const out = String(r.stdout ?? '');
	const m = out.match(/(\S+\.tgz)/);
	if (!m) throw new Error(`could not find tarball in pnpm pack output for ${packageFilter}:\n${out}`);
	return m[1]!;
}

async function installTarballs(
	targetRepo: string,
	mgr: 'yarn' | 'npm' | 'pnpm',
	tarballs: { spec: string; tgz: string }[],
): Promise<void> {
	const args = mgr === 'npm' ? ['install', '--no-save'] : mgr === 'pnpm' ? ['add'] : ['add'];
	for (const { spec, tgz } of tarballs) {
		args.push(`${spec}@${tgz}`);
	}
	const r = await x(mgr, args, { nodeOptions: { cwd: targetRepo, stdio: ['ignore', 'pipe', 'pipe'] } });
	if (r.exitCode !== 0) {
		throw new Error(
			`${mgr} ${args.join(' ')} failed (exit ${r.exitCode}):\n${r.stdout}\n${r.stderr}`,
		);
	}
}

async function replaceDistWithSymlink(
	targetRepo: string,
	pkgName: string,
	srcDist: string,
): Promise<void> {
	const installedDist = path.join(targetRepo, 'node_modules', pkgName, 'dist');
	try {
		await fs.rm(installedDist, { recursive: true, force: true });
	} catch {}
	await fs.symlink(srcDist, installedDist, 'dir');
}

/**
 * Copy (don't symlink) the dist into the target's node_modules. This is
 * the right choice when the target also has linked-monorepo Storybook
 * packages: Node resolves modules from the file's realpath, so a
 * symlinked addon-mcp/dist would resolve `storybook` from THIS repo's
 * own node_modules, breaking the singleton with the linked Storybook.
 * A plain copy keeps the realpath inside the target's node_modules tree.
 */
async function copyDist(srcDist: string, targetDist: string): Promise<void> {
	await fs.rm(targetDist, { recursive: true, force: true });
	await fs.cp(srcDist, targetDist, { recursive: true, dereference: true });
}

export async function linkAddonMcp(
	options: LinkAddonMcpOptions & { sync?: 'symlink' | 'copy' },
): Promise<{
	pm: 'yarn' | 'npm' | 'pnpm';
	tarballs: string[];
	sync: 'symlink' | 'copy';
	storybookLink?: StorybookLinkResult;
	mainStatus: MainTsStatus;
}> {
	const packDir = options.packDir ?? '/tmp/addon-mcp-pack';
	const pm = options.packageManager ?? (await detectPackageManager(options.targetRepo));
	// Default to copy: when the target also runs against a linked Storybook
	// monorepo, a dist symlink causes Node to resolve `storybook` via the
	// addon-mcp source's realpath (this monorepo), breaking the singleton.
	const sync = options.sync ?? 'copy';

	const addonTgz = await pack(options.monorepoRoot, '@storybook/addon-mcp', packDir);
	const mcpTgz = await pack(options.monorepoRoot, '@storybook/mcp', packDir);

	await installTarballs(options.targetRepo, pm, [
		{ spec: '@storybook/addon-mcp', tgz: addonTgz },
		{ spec: '@storybook/mcp', tgz: mcpTgz },
	]);

	const syncFn = sync === 'symlink' ? replaceDistWithSymlink : (target: string, pkg: string, src: string) => copyDist(src, path.join(target, 'node_modules', pkg, 'dist'));

	await syncFn(
		options.targetRepo,
		'@storybook/addon-mcp',
		path.join(options.monorepoRoot, 'packages/addon-mcp/dist'),
	);
	await syncFn(
		options.targetRepo,
		'@storybook/mcp',
		path.join(options.monorepoRoot, 'packages/mcp/dist'),
	);

	let storybookLink: StorybookLinkResult | undefined;
	if (options.storybookRepo) {
		storybookLink = await linkStorybookMonorepo({
			targetRepo: options.targetRepo,
			storybookRepo: options.storybookRepo,
			skipMissingDist: true,
		});
	}

	const mainStatus = await inspectStorybookMain(options.targetRepo);

	return { pm, tarballs: [addonTgz, mcpTgz], sync, storybookLink, mainStatus };
}
