#!/usr/bin/env node
// Full pipeline: materialise a tree, build it, drive the journeys, score it,
// and diff against the pinned ref's baseline.
//
//   node measure.mjs --project <collected project dir> \
//                    --ref <pinned ref checkout> \
//                    [--baseline baseline.json] [--out a11y.json]
//
// The project tree is never mutated: it is copied to a work directory first.
//
// Deliberately does NOT use the project's own package manager. A collected tree
// arrives with its lockfile clobbered (see report) and possibly with an
// npm/yarn mix, so `yarn build` fails on lockfile resolution before vite is
// ever reached. Dependencies come from the ref install and vite is invoked
// directly; deps are not what an a11y metric is measuring.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

function parseArgs(argv) {
	const args = { project: null, ref: null, baseline: null, out: null, keep: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--project') args.project = resolve(argv[++i]);
		else if (a === '--ref') args.ref = resolve(argv[++i]);
		else if (a === '--baseline') args.baseline = resolve(argv[++i]);
		else if (a === '--out') args.out = resolve(argv[++i]);
		else if (a === '--keep') args.keep = true;
	}
	if (!args.project || !args.ref) throw new Error('--project and --ref are required');
	return args;
}

const HARNESS = new URL('.', import.meta.url).pathname;

function build(workDir) {
	const vite = join(workDir, 'node_modules/vite/bin/vite.js');
	if (!existsSync(vite)) throw new Error(`vite not found at ${vite}`);
	// vite build only, no tsc: a type error is a different metric, and the app
	// still renders. Bundling failures are surfaced as a hard error below.
	execFileSync('node', [vite, 'build'], { cwd: workDir, stdio: 'pipe', timeout: 300_000 });
}

function measure(workDir, outPath) {
	execFileSync('node', [join(HARNESS, 'run-a11y.mjs'), '--app', workDir, '--out', outPath], {
		stdio: 'pipe',
		timeout: 600_000,
	});
	return JSON.parse(readFileSync(outPath, 'utf8'));
}

function score(record) {
	return {
		complete: record.totals.complete,
		distinctRules: record.totals.distinctRules,
		violationNodes: record.totals.violationNodes,
		weighted: record.totals.weighted,
		byImpact: record.totals.byImpact,
		rules: Object.fromEntries(record.totals.byRule.map((r) => [r.id, r.peakNodes])),
	};
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const work = join(tmpdir(), `a11y-${process.pid}`);
	const timings = {};
	const mark = (name, fn) => {
		const t0 = performance.now();
		const value = fn();
		timings[name] = Math.round(performance.now() - t0);
		return value;
	};

	rmSync(work, { recursive: true, force: true });
	mkdirSync(work, { recursive: true });

	try {
		// The measured tree, minus anything that would make the build
		// non-reproducible or is not ours to interpret.
		mark('copyMs', () => {
			cpSync(args.project, work, {
				recursive: true,
				filter: (src) => !/(^|\/)(node_modules|\.git|build)$/.test(src),
			});
			// Dependencies from the pinned ref, not from the agent's lockfile.
			cpSync(join(args.ref, 'node_modules'), join(work, 'node_modules'), { recursive: true });
		});

		let buildError = null;
		try {
			mark('buildMs', () => build(work));
		} catch (e) {
			buildError = String(e.stderr ?? e.message).slice(0, 800);
		}

		// A tree that does not build cannot be scored. Reported as an explicit
		// null result rather than as zero violations.
		if (buildError) {
			const record = { schema: 'a11y-measure/1', buildOk: false, buildError, score: null, timings };
			if (args.out) writeFileSync(args.out, JSON.stringify(record, null, 2) + '\n');
			console.log(JSON.stringify(record, null, 2));
			return;
		}

		const raw = mark('measureMs', () => measure(work, join(work, 'a11y-raw.json')));
		const current = score(raw);
		const baseline =
			args.baseline && existsSync(args.baseline)
				? JSON.parse(readFileSync(args.baseline, 'utf8'))
				: null;

		// Delta against the pinned ref, not an absolute count. The app ships with
		// pre-existing violations that no agent introduced; an absolute number
		// mostly measures those.
		const delta = baseline
			? {
					distinctRules: current.distinctRules - baseline.distinctRules,
					violationNodes: current.violationNodes - baseline.violationNodes,
					weighted: current.weighted - baseline.weighted,
					newRules: Object.keys(current.rules).filter((r) => !(r in baseline.rules)),
					fixedRules: Object.keys(baseline.rules).filter((r) => !(r in current.rules)),
				}
			: null;

		const record = {
			schema: 'a11y-measure/1',
			buildOk: true,
			axe: raw.axe.version,
			playwright: raw.playwright,
			timings,
			score: current,
			baseline,
			delta,
		};

		if (args.out) writeFileSync(args.out, JSON.stringify(record, null, 2) + '\n');
		console.log(JSON.stringify(record, null, 2));
	} finally {
		if (!args.keep) rmSync(work, { recursive: true, force: true });
	}
}

main();
