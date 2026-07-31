// Classify an agent's tool calls into five buckets.
//
// To measure documentation quality indirectly, we want to measure whether doc tool
// calls helped reduce the number of other tool calls (e.g. fewer edits or less code
// exploration). The first step to that is classifying each tool call.
//
// Buckets:
// - docs: the agent is reading documentation, e.g. get-documentation, web_fetch.
// - exploration: the agent is reading code or other files, e.g. file_read, glob, grep.
// - edit: the agent is writing to files, e.g. file_edit, file_write.
// - verification: the agent is running tests or linters, e.g. run-story-tests, tsc.
// - other: the agent is doing something else, e.g. preview-stories, display-review.
import { isRecord } from '../../utils/type.ts';
import { splitCommandSegments } from '../../utils/shell-segments.ts';

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
const COMMAND_PREFIXES = new Set(['sudo', 'env', 'time', 'nohup', 'command', 'exec', 'xargs']);

/**
 * Short flags that consume the next token, per wrapper. Skipping anything that
 * starts with `-` is enough for most wrappers, but not for `xargs`: its options
 * interleave with the command it runs, so `xargs -n 1 rm` would stop on `1` and
 * classify the run as the binary `1`.
 *
 * Only flags whose argument is *mandatory* are listed. GNU's optional-argument
 * forms (`-i[R]`, `--replace[=R]`, `--max-lines[=N]`) must not appear: with
 * `xargs -i rm` the argument is absent and eating the next token would swallow
 * the command. Long options carry their value inline with `=`, so they need no
 * entry. Covers GNU and the BSD-only `-J`/`-R`/`-S`.
 */
const VALUED_FLAGS: Record<string, Set<string>> = {
	xargs: new Set(['-a', '-d', '-E', '-I', '-J', '-L', '-n', '-P', '-R', '-S', '-s']),
};

/**
 * Advance past a wrapper's own flags, consuming the value of any flag that
 * takes one separately. A bare `--` ends the option list and is skipped too,
 * leaving the wrapped command next.
 */
function skipFlags(tokens: string[], from: number, wrapper: string): number {
	const valued = VALUED_FLAGS[wrapper];
	let index = from;
	while (index < tokens.length) {
		const token = tokens[index] ?? '';
		if (!token.startsWith('-')) break;
		index += 1;
		if (token === '--') break;
		// `-n5` and `--max-args=5` carry the value inline; only the exact flag
		// spelling takes the following token.
		if (valued?.has(token) && index < tokens.length) index += 1;
	}
	return index;
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Resolve the binary a segment actually invokes, stepping past `ENV=value`
 * prefixes and package-runner wrappers. `npx tsc` is a typecheck, not an npx.
 */
/** Subshell and grouping punctuation the tokenizer leaves attached to a word. */
function stripGrouping(token: string): string {
	return token.replace(/^[({]+/, '').replace(/[)}]+$/, '');
}

function resolveHead(tokens: string[]): { head: string; rest: string[]; viaXargs: boolean } {
	let index = 0;
	let viaXargs = false;
	const at = (position: number) => stripGrouping(tokens[position] ?? '');

	// Step past `ENV=value` prefixes and command wrappers such as `sudo` or
	// `time`, which stand in front of the binary that actually runs. A wrapper's
	// own flags go with it: `sudo -n apt-get` would otherwise resolve to `-n`.
	while (index < tokens.length) {
		if (ENV_ASSIGNMENT.test(tokens[index] ?? '')) {
			index += 1;
			continue;
		}
		const prefix = at(index);
		if (COMMAND_PREFIXES.has(prefix)) {
			if (prefix === 'xargs') viaXargs = true;
			index = skipFlags(tokens, index + 1, prefix);
			continue;
		}
		break;
	}

	let head = at(index);
	if (PACKAGE_RUNNERS.has(head)) {
		index = skipFlags(tokens, index + 1, head);
		// `pnpm run typecheck` names a script, not a binary; the script's contents
		// are not visible here, so it stays unclassified rather than guessed at.
		if (tokens[index] === 'exec') index += 1;
		head = at(index);
	}

	return { head: head.replace(/^.*\//, ''), rest: tokens.slice(index + 1), viaXargs };
}

function classifySegmentTokens(tokens: string[]): {
	bucket: Bucket | null;
	head: string;
	viaXargs: boolean;
} {
	const { head, rest, viaXargs } = resolveHead(tokens);
	const at = (bucket: Bucket | null) => ({ bucket, head, viaXargs });
	if (head === '') return at(null);
	if (NOISE_BINARIES.has(head)) return at(null);

	// `sed -i` / `awk -i inplace` write; without the flag they read.
	if (head === 'sed' || head === 'awk') {
		const inPlace = rest.some((token) => token === '-i' || token.startsWith('-i'));
		return at(inPlace ? 'edit' : 'exploration');
	}

	if (EDIT_BINARIES.has(head)) return at('edit');
	if (VERIFICATION_BINARIES.has(head)) return at('verification');
	if (EXPLORATION_BINARIES.has(head)) return at('exploration');
	return at('other');
}

function collectShellBuckets(command: string, buckets: Set<Bucket>, unclassified: string[]): void {
	for (const segment of splitCommandSegments(command)) {
		const { bucket, head, viaXargs } = classifySegmentTokens(segment.tokens);

		// Downstream of a pipe: a filter on the previous command's output, not an
		// independent act. Without this, `npx tsc | tail -20` reads as exploration.
		//
		// `xargs` is the exception, and the reason flag-skipping alone was never
		// enough to support it: it does not filter its input, it runs a command
		// with it, so `find . | xargs rm` really is an edit.
		if (segment.piped && !viaXargs) continue;

		if (segment.redirectTarget !== null) {
			buckets.add('edit');
			continue;
		}

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
