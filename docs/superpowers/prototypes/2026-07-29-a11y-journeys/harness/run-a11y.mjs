#!/usr/bin/env node
// Accessibility measurement for a built mealdrop tree.
//
//   node run-a11y.mjs --app <dir> [--out result.json] [--serve static|preview|dev]
//                     [--no-stub-images] [--headed]
//
// --app points at the app root (the one containing build/ for static serving).
// Emits a JSON record on stdout and, with --out, to disk.
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

import { serveStatic } from './lib/server.mjs';
import { installMocks } from './lib/mock.mjs';
import { resolveAxeSource, installAxe, runAxe, DEFAULT_AXE_OPTIONS } from './lib/axe.mjs';

function parseArgs(argv) {
	const args = {
		app: null,
		out: null,
		serve: 'static',
		stubImages: true,
		headed: false,
		viewport: { width: 1280, height: 720 },
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--app') args.app = resolve(argv[++i]);
		else if (a === '--out') args.out = resolve(argv[++i]);
		else if (a === '--serve') args.serve = argv[++i];
		else if (a === '--no-stub-images') args.stubImages = false;
		else if (a === '--headed') args.headed = true;
	}
	if (!args.app) throw new Error('--app <dir> is required');
	return args;
}

/** Start a dev/preview server via the app's own tooling and wait for its port. */
async function serveViaVite(appDir, mode) {
	const port = mode === 'dev' ? 3000 : 4173;
	// detached: yarn spawns vite as a grandchild, so killing the yarn PID alone
	// orphans vite still holding the port. Own process group, killed as a group.
	const child = spawn(
		'node',
		[join(appDir, '.yarn/releases/yarn-4.2.1.cjs'), mode === 'dev' ? 'start' : 'serve'],
		{ cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
	);
	// `localhost`, not 127.0.0.1: vite binds the IPv6 loopback ([::1]) only, so
	// an IPv4 literal gets ECONNREFUSED even though the server is up. On a host
	// without IPv6 this flips the other way -- one more reason the static
	// server, which binds 127.0.0.1 explicitly, is the reproducible choice.
	const url = `http://localhost:${port}`;

	const killGroup = () => {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {
			// Group already gone.
		}
	};

	const deadline = Date.now() + 60_000;
	for (;;) {
		if (Date.now() > deadline) {
			killGroup();
			throw new Error(`${mode} server did not come up on ${port}`);
		}
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
			if (res.ok) break;
		} catch {
			await new Promise((r) => setTimeout(r, 250));
		}
	}

	return {
		url,
		requests: [],
		close: async () => {
			killGroup();
			await new Promise((r) => setTimeout(r, 300));
		},
	};
}

async function loadJourneys() {
	const dir = new URL('./journeys/', import.meta.url).pathname;
	const files = readdirSync(dir)
		.filter((f) => f.endsWith('.mjs'))
		.sort();
	const out = [];
	for (const f of files) out.push((await import(join(dir, f))).default);
	return out;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const timings = {};
	const mark = async (name, fn) => {
		const t0 = performance.now();
		const value = await fn();
		timings[name] = Math.round(performance.now() - t0);
		return value;
	};

	// Playwright and axe-core both come from the app's own install here. In a
	// real harness they must be pinned by the harness instead (see report).
	const require = createRequire(join(args.app, 'noop.js'));
	const { chromium } = require('playwright');
	const axe = resolveAxeSource(args.app);

	const buildDir = join(args.app, 'build');
	if (args.serve === 'static' && !existsSync(join(buildDir, 'index.html'))) {
		throw new Error(`no build/index.html in ${args.app}; run the build first`);
	}

	const server = await mark('serveMs', () =>
		args.serve === 'static' ? serveStatic(buildDir) : serveViaVite(args.app, args.serve),
	);

	const browser = await mark('browserLaunchMs', () =>
		chromium.launch({ headless: !args.headed }),
	);

	const journeys = await loadJourneys();
	const results = [];

	try {
		for (const journey of journeys) {
			const t0 = performance.now();
			const context = await browser.newContext({
				viewport: args.viewport,
				// use-dark-mode reads prefers-color-scheme; pinning it keeps
				// colour-contrast results from flipping with the host's settings.
				colorScheme: 'light',
				reducedMotion: 'reduce',
				locale: 'en-US',
				timezoneId: 'UTC',
			});

			const netLog = await installMocks(context, { stubImages: args.stubImages });
			const page = await context.newPage();

			const consoleErrors = [];
			page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 300)));
			const pageErrors = [];
			page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));

			await installAxe(page, axe.source);

			let outcome = null;
			let error = null;
			const checkpoints = [];

			// Journeys scan at each meaningful state. Handing them a scan()
			// callback rather than scanning once at the end is what makes an
			// intermediate-page regression visible at all.
			const scan = async (label) => {
				// Let styled-components flush and any transition settle; axe reads
				// computed style, so scanning mid-animation produces noise.
				await page.waitForTimeout(150);
				checkpoints.push({
					label,
					path: new URL(page.url()).pathname,
					...(await runAxe(page)),
				});
			};

			try {
				outcome = await journey.run(page, { baseUrl: server.url, scan });
			} catch (e) {
				error = String(e.message).split('\n').slice(0, 4).join(' | ');
			}

			await context.close();

			results.push({
				id: journey.id,
				description: journey.description,
				// A journey that threw did not visit the states it claims to cover,
				// so its checkpoints are a partial sample. Treated as invalid rather
				// than as evidence of a clean app.
				ok: error === null,
				error,
				outcome,
				expectedCheckpoints: journey.checkpoints ?? null,
				durationMs: Math.round(performance.now() - t0),
				network: { ...netLog, unexpected: [...new Set(netLog.unexpected)] },
				consoleErrors: consoleErrors.slice(0, 10),
				pageErrors: pageErrors.slice(0, 10),
				checkpoints,
			});
		}
	} finally {
		await browser.close();
		await server.close();
	}

	// Aggregate over every checkpoint of every journey.
	//
	// Two different counts, because they answer different questions and the
	// difference matters:
	//
	//   ruleNodePeak - for each rule, the WORST single checkpoint. Summing nodes
	//     across checkpoints double-counts: the header is present in all of
	//     them, so one bad header would score 8x. Peak is stable against how
	//     many checkpoints a journey happens to declare.
	//
	//   distinctRules - how many separate a11y defects exist. Does not move when
	//     the app happens to render more rows of data.
	const allCheckpoints = results.flatMap((r) =>
		r.checkpoints.map((c) => ({ ...c, journey: r.id })),
	);

	const byRule = new Map();
	for (const c of allCheckpoints) {
		for (const v of c.violations) {
			const prev = byRule.get(v.id) ?? {
				id: v.id,
				impact: v.impact,
				peakNodes: 0,
				checkpoints: [],
			};
			prev.peakNodes = Math.max(prev.peakNodes, v.nodeCount);
			prev.checkpoints.push(`${c.journey}/${c.label}`);
			byRule.set(v.id, prev);
		}
	}

	const rules = [...byRule.values()].sort((a, b) => b.peakNodes - a.peakNodes);
	const impactWeight = { critical: 10, serious: 5, moderate: 2, minor: 1 };
	const complete = results.every((r) => r.ok);

	const record = {
		schema: 'a11y/2',
		app: args.app,
		serveMode: args.serve,
		stubImages: args.stubImages,
		axe: { version: axe.version, options: DEFAULT_AXE_OPTIONS },
		playwright: require('playwright/package.json').version,
		timings,
		journeys: results,
		totals: {
			// Any failed journey makes the whole record untrustworthy: an a11y
			// regression can break the journey that would have measured it, and a
			// half-run suite reports FEWER violations than a healthy app. Callers
			// must check this before comparing numbers.
			complete,
			journeys: results.length,
			journeysOk: results.filter((r) => r.ok).length,
			checkpoints: allCheckpoints.length,
			distinctRules: rules.length,
			violationNodes: rules.reduce((s, r) => s + r.peakNodes, 0),
			weighted: rules.reduce((s, r) => s + r.peakNodes * (impactWeight[r.impact] ?? 1), 0),
			byImpact: Object.fromEntries(
				['critical', 'serious', 'moderate', 'minor'].map((k) => [
					k,
					rules.filter((r) => r.impact === k).length,
				]),
			),
			byRule: rules,
		},
	};

	if (args.out) writeFileSync(args.out, JSON.stringify(record, null, 2) + '\n');
	process.stdout.write(JSON.stringify(record, null, 2) + '\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
