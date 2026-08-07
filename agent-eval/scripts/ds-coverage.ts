// Run the ds-coverage analyzer against a checked-out tree, for humans.
//
//   node scripts/ds-coverage.ts <dir> --ds '@base-ui/react' --ds '@droppy/*' [--json] [--per-file]
//
// The analyzer itself lives in lib/agentic-reference/metrics/ds-coverage/.
// This wrapper only parses arguments and renders tables.
// `--json` prints the full report for piping into jq.
//
// `--filter <glob>` selects which files are counted, and is repeatable. Globs
// are picomatch patterns, written relative to <dir> or as an absolute path
// inside it, and a `!` prefix excludes:
//
//   --filter '!core/src/components/**'   everything but that directory
//   --filter 'src/**'                    only that directory
//   --filter 'src/**' --filter '!src/debug/**'   that directory, less a corner
//
// A filtered-out file still resolves — it leaves the count, not the module
// graph — which is what makes it usable on a monorepo that vendors its own
// design system without stranding every import into it.
import { statSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { analyzeDsCoverage } from '../lib/agentic-reference/metrics/ds-coverage/index.ts';

const USAGE =
	'usage: node scripts/ds-coverage.ts <dir> --ds <pattern> [--ds <pattern>...] ' +
	'[--filter <glob>...] [--json] [--per-file] [--top <n>]\n' +
	"       globs are relative to <dir>; prefix with ! to exclude, e.g. --filter '!core/src/components/**'";

const { values, positionals } = parseArgs({
	options: {
		ds: { type: 'string', multiple: true },
		filter: { type: 'string', multiple: true },
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
	console.error(`ds-coverage: not a directory: ${dir}`);
	process.exit(2);
}
const top = Number(values.top);
if (!Number.isInteger(top) || top < 1) {
	console.error(`ds-coverage: --top must be a positive integer, got '${values.top}'\n${USAGE}`);
	process.exit(2);
}

// A bad --filter is a usage mistake like the ones above, so it reads as one
// rather than as a stack trace out of the analyzer.
const censusFilters = values.filter ?? [];
let report;
try {
	report = analyzeDsCoverage({ projectDir: dir, dsPackages, censusFilters });
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(2);
}

if (values.json) {
	console.log(JSON.stringify(report, null, 2));
	process.exit(0);
}

console.log(`ds-coverage of ${dir}`);
console.log(`  DS packages:  ${report.dsPackages.join(', ')}`);
if (report.censusFilters.length > 0) {
	// Named on its own line because it changes what the shares below mean.
	console.log(`  filters:      ${report.censusFilters.join(', ')} (unmatched files still resolve)`);
}
console.log(
	`  files:        ${report.files} (${report.parseFailures.length} unparseable, ${report.readFailures.length} unreadable)`,
);
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
