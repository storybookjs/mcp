// Classify an agent's tool calls into five buckets.
//
// The documentation-quality proxy this feeds asks: did the agent lean on the
// design system's documentation, or grope through source? That needs
// `exploration` and `docs` kept clean, which in turn forces two buckets the
// original three-way split did not have.
//
// `verification` exists because tsc/eslint/vitest are neither exploration nor
// edits, and folding them into exploration would make a *more* careful agent
// score worse on a lower-is-better metric. `other` exists so the buckets
// reconcile against the call total instead of silently dropping calls.
//
// Only raw counts are stored. The exploration-to-docs ratio is a cross-arm
// comparison, not a property of one run, so it is computed later over all runs.
import { isRecord } from '../../../lib/shell-parse.ts';
import { splitCommandSegments } from './shell-segments.ts';

export type Bucket = 'docs' | 'exploration' | 'edit' | 'verification' | 'other';

export interface ToolUseMetrics {
	buckets: Record<Bucket, number>;
	/** Shell heads that matched no rule, always analyse and retrofit manually into buckets. */
	unclassified: string[];
}

const EXPLORATION_BINARIES = new Set([
	'ls',
	'cat',
	'grep',
	'rg',
	'find',
	'fd',
	'head',
	'tail',
	'wc',
	'tree',
	'stat',
	'file',
	'less',
	'more',
	'diff',
	'realpath',
	'pwd',
]);

const VERIFICATION_BINARIES = new Set([
	'tsc',
	'eslint',
	'oxlint',
	'biome',
	'prettier',
	'oxfmt',
	'vitest',
	'jest',
	'playwright',
	'test-storybook',
	'git',
	'node',
	'tsx',
]);

const EDIT_BINARIES = new Set(['cp', 'mv', 'rm', 'mkdir', 'touch', 'tee', 'chmod', 'ln']);

const NOISE_BINARIES = new Set([
	'echo',
	'true',
	'false',
	'printf',
	'sleep',
	'kill',
	'pkill',
	'wait',
	'export',
	'cd',
]);

/** Wrappers to step past to reach the binary that actually runs. */
const PACKAGE_RUNNERS = new Set(['npx', 'npm', 'pnpm', 'yarn', 'bun', 'bunx']);
// `xargs` is deliberately absent: its own arguments interleave with the command
// it runs (`xargs -n 1 rm`), so stepping past it cannot be done by flag-skipping.
const COMMAND_PREFIXES = new Set(['sudo', 'env', 'time', 'nohup', 'command', 'exec']);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Resolve the binary a segment actually invokes, stepping past `ENV=value`
 * prefixes and package-runner wrappers. `npx tsc` is a typecheck, not an npx.
 */
/** Subshell and grouping punctuation the tokenizer leaves attached to a word. */
function stripGrouping(token: string): string {
	return token.replace(/^[({]+/, '').replace(/[)}]+$/, '');
}

function resolveHead(tokens: string[]): { head: string; rest: string[] } {
	let index = 0;
	const at = (position: number) => stripGrouping(tokens[position] ?? '');

	// Step past `ENV=value` prefixes and command wrappers such as `sudo` or
	// `time`, which stand in front of the binary that actually runs. A wrapper's
	// own flags go with it: `sudo -n apt-get` would otherwise resolve to `-n`.
	while (index < tokens.length) {
		if (ENV_ASSIGNMENT.test(tokens[index] ?? '')) {
			index += 1;
			continue;
		}
		if (COMMAND_PREFIXES.has(at(index))) {
			index += 1;
			while (index < tokens.length && (tokens[index] ?? '').startsWith('-')) index += 1;
			continue;
		}
		break;
	}

	let head = at(index);
	if (PACKAGE_RUNNERS.has(head)) {
		index += 1;
		while (index < tokens.length && (tokens[index] ?? '').startsWith('-')) index += 1;
		// `pnpm run typecheck` names a script, not a binary; the script's contents
		// are not visible here, so it stays unclassified rather than guessed at.
		if (tokens[index] === 'exec') index += 1;
		head = at(index);
	}

	return { head: head.replace(/^.*\//, ''), rest: tokens.slice(index + 1) };
}

function classifySegmentTokens(tokens: string[]): { bucket: Bucket | null; head: string } {
	const { head, rest } = resolveHead(tokens);
	if (head === '') return { bucket: null, head };
	if (NOISE_BINARIES.has(head)) return { bucket: null, head };

	// `sed -i` / `awk -i inplace` write; without the flag they read.
	if (head === 'sed' || head === 'awk') {
		const inPlace = rest.some((token) => token === '-i' || token.startsWith('-i'));
		return { bucket: inPlace ? 'edit' : 'exploration', head };
	}

	if (EDIT_BINARIES.has(head)) return { bucket: 'edit', head };
	if (VERIFICATION_BINARIES.has(head)) return { bucket: 'verification', head };
	if (EXPLORATION_BINARIES.has(head)) return { bucket: 'exploration', head };
	return { bucket: 'other', head };
}

function collectShellBuckets(command: string, buckets: Set<Bucket>, unclassified: string[]): void {
	for (const segment of splitCommandSegments(command)) {
		// Downstream of a pipe: a filter on the previous command's output, not an
		// independent act. Without this, `npx tsc | tail -20` reads as exploration.
		if (segment.piped) continue;

		if (segment.redirectTarget !== null) {
			buckets.add('edit');
			continue;
		}

		const { bucket, head } = classifySegmentTokens(segment.tokens);
		if (bucket === null) continue;
		if (bucket === 'other' && head !== '') unclassified.push(head);
		buckets.add(bucket);
	}
}

/** Buckets a single shell command may contribute to. Deduplicated. */
export function classifyShellCommand(command: string): Bucket[] {
	const buckets = new Set<Bucket>();
	collectShellBuckets(command, buckets, []);
	return [...buckets];
}

/**
 * MCP calls arrive as `name: 'unknown'` with the real identity in
 * `originalName`. The name is not missing — the harness's normaliser maps tools
 * onto a fixed set of categories (file_read, shell, glob, …) and has no category
 * for an MCP workflow, so it emits `unknown` and preserves the original.
 *
 * Classifying on the `mcp__` prefix alone would be wrong: the design-system MCP
 * exposes nine workflows and only three of them are documentation. Doing so
 * scored `preview-stories` and `run-story-tests` as documentation reads —
 * inflating the exact signal this experiment exists to measure, and it would
 * count any unrelated MCP server's tools as documentation too.
 */
const MCP_PREFIX = 'mcp__';

/** `mcp__<server>__<workflow>` — the workflow is what identifies the call. */
function mcpWorkflowName(originalName: string): string {
	return originalName.slice(originalName.lastIndexOf('__') + 2);
}

/**
 * The design-system MCP's workflows, by what the agent is actually doing.
 * The documentation subset mirrors DOCUMENTATION_WORKFLOW_NAMES in EVAL.ts,
 * which gates the eval itself; an unlisted workflow lands in `other` and is
 * recorded in `unclassified` rather than guessed at.
 */
const MCP_WORKFLOW_BUCKETS: Record<string, Bucket> = {
	'get-documentation': 'docs',
	'get-documentation-for-story': 'docs',
	'list-all-documentation': 'docs',
	'run-story-tests': 'verification',
	'get-changed-stories': 'other',
	'get-stories-by-component': 'other',
	'get-storybook-story-instructions': 'other',
	'preview-stories': 'other',
	'display-review': 'other',
};

const STRUCTURED_BUCKETS: Record<string, Bucket> = {
	file_read: 'exploration',
	glob: 'exploration',
	grep: 'exploration',
	list_dir: 'exploration',
	file_edit: 'edit',
	file_write: 'edit',
	web_fetch: 'docs',
	web_search: 'docs',
};

export function classifyToolUse(events: unknown[]): ToolUseMetrics {
	const buckets: Record<Bucket, number> = {
		docs: 0,
		exploration: 0,
		edit: 0,
		verification: 0,
		other: 0,
	};
	const unclassified: string[] = [];

	for (const event of events) {
		if (!isRecord(event) || event.type !== 'tool_call' || !isRecord(event.tool)) {
			continue;
		}

		const { name, originalName, args } = event.tool;

		if (typeof originalName === 'string' && originalName.startsWith(MCP_PREFIX)) {
			const workflow = mcpWorkflowName(originalName);
			const bucket = MCP_WORKFLOW_BUCKETS[workflow];
			if (bucket === undefined) unclassified.push(`mcp:${workflow}`);
			buckets[bucket ?? 'other'] += 1;
			continue;
		}

		if (name === 'shell') {
			const command = isRecord(args) && typeof args.command === 'string' ? args.command : '';
			const found = new Set<Bucket>();
			collectShellBuckets(command, found, unclassified);
			for (const bucket of found) {
				buckets[bucket] += 1;
			}
			continue;
		}

		const structured = typeof name === 'string' ? STRUCTURED_BUCKETS[name] : undefined;
		buckets[structured ?? 'other'] += 1;
	}

	return { buckets, unclassified };
}
