// Run the ds-share analyzer against a checked-out tree, for humans.
//
//   node scripts/ds-share.ts <dir> --ds '@base-ui/react' --ds '@droppy/*' [--json] [--per-file]
//
// The analyzer itself lives in lib/agentic-reference/metrics/ds-share/; this
// wrapper only parses arguments and renders tables. `--json` prints the full
// report (including every unresolved element) for piping into jq.
import { statSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { analyzeDsShare } from '../lib/agentic-reference/metrics/ds-share/index.ts';

const USAGE =
	'usage: node scripts/ds-share.ts <dir> --ds <pattern> [--ds <pattern>...] [--json] [--per-file] [--top <n>]';

const { values, positionals } = parseArgs({
	options: {
		ds: { type: 'string', multiple: true },
		json: { type: 'boolean', default: false },
		'per-file': { type: 'boolean', default: false },
		top: { type: 'string', default: '25' },
	},
	allowPositionals: true,
});

const dir = positionals[0];
const dsPackages = values.ds ?? [];
if (dir === undefined || dsPackages.length === 0) {
	console.error(USAGE);
	process.exit(2);
}
// A typo'd path would otherwise "analyze" an empty tree and report 0 files as
// if that were a measurement.
let isDirectory = false;
try {
	isDirectory = statSync(dir).isDirectory();
} catch {
	isDirectory = false;
}
if (!isDirectory) {
	console.error(`ds-share: not a directory: ${dir}`);
	process.exit(2);
}
const top = Number(values.top);
if (!Number.isInteger(top) || top < 1) {
	console.error(`ds-share: --top must be a positive integer, got '${values.top}'\n${USAGE}`);
	process.exit(2);
}

const report = analyzeDsShare(dir, { dsPackages });

if (values.json) {
	console.log(JSON.stringify(report, null, 2));
	process.exit(0);
}

console.log(`ds-share of ${dir}`);
console.log(`  DS packages:  ${report.dsPackages.join(', ')}`);
console.log(`  files:        ${report.files} (${report.parseFailures.length} unparseable)`);
console.log(`  JSX nodes:    ${report.nodes.all} weighted`);
console.table({
	host: report.nodes.host,
	ds: report.nodes.ds,
	external: report.nodes.external,
	local: report.nodes.local,
	unresolved: report.nodes.unresolved,
});
console.log(`  DS share of all JSX nodes:        ${report.dsShareOfAllNodes}`);
console.log(`  DS share of component elements:   ${report.dsShareOfComponentNodes}`);

const nonHost = Object.entries(report.components).filter(([, entry]) => entry.category !== 'host');
console.log(`\nTop components (of ${nonHost.length}):`);
console.table(Object.fromEntries(nonHost.slice(0, top)));

if (report.unresolvedElements.length > 0) {
	console.log(`Unresolved elements (${report.unresolvedElements.length}):`);
	for (const element of report.unresolvedElements.slice(0, top)) {
		console.log(`  ${element.file}:${element.line} <${element.tag}> — ${element.reason}`);
	}
	if (report.unresolvedElements.length > top) {
		console.log(`  … ${report.unresolvedElements.length - top} more (use --json for all)`);
	}
}

if (values['per-file']) {
	console.log('\nPer-file:');
	console.table(report.perFile);
}
