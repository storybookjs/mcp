#!/usr/bin/env node
/**
 * CLI: install addon-mcp from THIS branch into a target repo and
 * symlink the `dist/` so source edits flow through. Optionally also
 * mirror the Storybook monorepo's built packages into the target's
 * node_modules (so older targets get 10.4+ change-detection without
 * bumping their own deps).
 *
 *   pnpm link-addon-mcp \
 *     --target /Users/yannbraga/Dev/mealdrop \
 *     --storybook-repo /Users/yannbraga/open-source/storybook
 *
 * After this, register `@storybook/addon-mcp` (and, if you want the
 * review-changes page, `@storybook/addon-review-changes`) in the
 * target's `.storybook/main.ts`, then start its Storybook normally.
 * Re-run after version bumps; the dist symlink itself is preserved
 * across re-runs.
 */
import { program } from 'commander';
import path from 'node:path';
import { linkAddonMcp } from '../lib/link-addon-mcp.ts';

program
	.requiredOption('--target <dir>', 'target repo to link addon-mcp into')
	.option('--monorepo-root <dir>', "this monorepo's root", path.resolve('..'))
	.option('--storybook-repo <dir>', "Storybook monorepo root (contains code/core, etc.). When set, mirrors its built packages into the target's node_modules so the target gets 10.4+ change-detection.")
	.option('--pack-dir <dir>', 'tarball destination', '/tmp/addon-mcp-pack')
	.option('--pm <mgr>', 'package manager: yarn | pnpm | npm (auto by default)')
	.option('--sync <mode>', "'copy' (default; safe with linked Storybook) | 'symlink' (live, but breaks storybook singleton when both linked)", 'copy');

program.parse();
const opts = program.opts<{
	target: string;
	monorepoRoot: string;
	storybookRepo?: string;
	packDir: string;
	pm?: string;
	sync: string;
}>();

const { target, storybookRepo } = opts;

const result = await linkAddonMcp({
	monorepoRoot: path.resolve(opts.monorepoRoot),
	targetRepo: path.resolve(target),
	storybookRepo: storybookRepo ? path.resolve(storybookRepo) : undefined,
	packDir: opts.packDir,
	packageManager: opts.pm as 'yarn' | 'npm' | 'pnpm' | undefined,
	sync: opts.sync as 'copy' | 'symlink',
});

console.log(`✓ Linked @storybook/addon-mcp (+ @storybook/mcp) into ${target}`);
console.log(`  package manager: ${result.pm}`);
console.log(`  sync mode: ${result.sync}`);
console.log(`  tarballs: ${result.tarballs.join(', ')}`);

if (result.storybookLink) {
	console.log('');
	console.log(`✓ Mirrored Storybook monorepo packages from ${storybookRepo}`);
	if (result.storybookLink.linked.length > 0) {
		console.log(`  linked (${result.storybookLink.linked.length}):`);
		for (const pkg of result.storybookLink.linked) console.log(`    - ${pkg}`);
	}
	if (result.storybookLink.skipped.length > 0) {
		console.log(`  skipped (${result.storybookLink.skipped.length}):`);
		for (const { pkg, reason } of result.storybookLink.skipped) {
			console.log(`    - ${pkg}: ${reason}`);
		}
	}
}

// Status checklist — what the user still has to wire in `.storybook/main.ts`.
console.log('');
if (!result.mainStatus.mainPath) {
	console.log('⚠ Could not find a .storybook/main.{ts,js,mjs,cjs} in the target.');
	console.log('  Create one and register the three items below.');
} else {
	console.log(`Storybook config status (${path.relative(process.cwd(), result.mainStatus.mainPath)}):`);
}

const mark = (done: boolean) => (done ? '✓' : '✗');
const label = (done: boolean) => (done ? '(done)' : '(not done)');
console.log('');
console.log('  You must add and register:');
console.log(`    ${mark(result.mainStatus.addonMcpRegistered)} @storybook/addon-mcp ${label(result.mainStatus.addonMcpRegistered)}`);
console.log(`    ${mark(result.mainStatus.changeDetectionEnabled)} features.changeDetection ${label(result.mainStatus.changeDetectionEnabled)}`);
console.log(`    ${mark(result.mainStatus.addonReviewChangesRegistered)} @storybook/addon-review-changes ${label(result.mainStatus.addonReviewChangesRegistered)}`);

const incomplete =
	!result.mainStatus.addonMcpRegistered ||
	!result.mainStatus.changeDetectionEnabled ||
	!result.mainStatus.addonReviewChangesRegistered;

if (incomplete) {
	console.log('');
	console.log('  Snippet for .storybook/main.ts:');
	console.log("    addons: [..., '@storybook/addon-mcp', '@storybook/addon-review-changes'],");
	console.log('    features: { changeDetection: true },');
	if (!result.mainStatus.addonReviewChangesRegistered) {
		console.log('');
		console.log('  Note: @storybook/addon-review-changes lives in the Storybook monorepo.');
		console.log('  Install it (e.g. yarn add link:<storybook>/code/addons/review-changes), then register it above.');
	}
}

console.log('');
console.log('Next:');
console.log('  1. Apply any missing items above.');
console.log('  2. Start Storybook in the target.');
console.log('  3. Run `pnpm capture --cwd <target> --storybook-url <url> --task "…" --out review-changes/captures/<slug> --keep-changes`.');
if (result.sync === 'copy') {
	console.log('');
	console.log('Note: --sync=copy installs a snapshot. Re-run this CLI after editing addon-mcp source.');
}
