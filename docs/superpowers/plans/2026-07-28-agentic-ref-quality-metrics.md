# Agentic-Reference Quality Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect speed, cost, SLoC, churn, complexity, and tool-use metrics automatically for every agentic-reference eval run, writing them to a per-run `analysis.json` that ships in the CI artifact.

**Architecture:** `scripts/analyze-results.mjs` becomes a generic gateway that discovers runs and dispatches to a per-eval hook at `evals/<name>/post-analysis.ts`. All eval-specific metric code lives in `evals/<name>/__analysis__/` as TypeScript modules, imported directly by the `.mjs` gateway using Node 24's native type stripping. Every metric is a pure function of stored artifacts, so the whole suite is testable against one already-captured run with zero LLM cost.

**Tech Stack:** Node 24 (native TS type stripping), TypeScript 5.9.3 (compiler API for AST walking), vitest, `diff` (jsdiff) for LCS line diffing.

## Global Constraints

- **Node 24+ required.** Modules are `.ts` imported from `.mjs`; this relies on native type stripping. All code must be erasable-syntax-only: no `enum`, no `namespace`, no parameter properties, no decorators.
- **Never store `Infinity` or `NaN`.** Any ratio with a zero denominator is `null`. A stored `Infinity` poisons every downstream mean.
- **Distinguish "absent" from "zero".** A metric that could not be computed is `null`; a metric measured as zero is `0`.
- **Tabs for indentation**, single quotes, semicolons — match existing `agent-eval/lib/*.ts` style. The repo formats with `oxfmt` (`pnpm format`).
- **Import paths carry explicit `.ts` extensions** (e.g. `import { x } from './y.ts'`) — required by both Node type stripping and the existing codebase convention.
- `agent-eval/results/` and `agent-eval/.eval-cache/` are **gitignored**. Test fixtures must be copied into `__fixtures__/` and committed.
- Working directory for all commands is `/home/steve/Development/mcp` unless stated otherwise.

## File Structure

| Path                                                                    | Responsibility                                        |
| ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `agent-eval/lib/shell-parse.ts`                                         | _(modify)_ export the existing `tokenizeShellCommand` |
| `agent-eval/evals/701-agentic-ref-reuse-component-mcp/post-analysis.ts` | The hook. Wires helpers together, returns one record. |
| `.../__analysis__/shell-segments.ts`                                    | Split a shell command into classifiable segments      |
| `.../__analysis__/tool-taxonomy.ts`                                     | Classify tool calls into 5 buckets                    |
| `.../__analysis__/churn.ts`                                             | Per-file edit counts                                  |
| `.../__analysis__/run-signals.ts`                                       | Speed + cost from `result.json`                       |
| `.../__analysis__/sloc.ts`                                              | Comment/blank stripping                               |
| `.../__analysis__/tree-diff.ts`                                         | Ref-vs-project changed files + SLoC delta             |
| `.../__analysis__/cyclomatic.ts`                                        | Cyclomatic complexity walker (ported)                 |
| `.../__analysis__/cognitive.ts`                                         | Cognitive complexity walker (new)                     |
| `.../__analysis__/external-ref.ts`                                      | Fetch + cache the pinned ref                          |
| `.../__analysis__/baseline.ts`                                          | Precomputed per-sha complexity baseline               |
| `.../__analysis__/baselines/<repo>@<sha>.json`                          | Committed baseline data                               |
| `agent-eval/scripts/analyze-results.mjs`                                | _(rewrite)_ generic gateway                           |

**Task order rationale:** Tasks 1–9 build independent leaf modules, each testable alone. Task 10 composes them. Task 11 rewrites the gateway. Task 12 handles infrastructure. Task 13 is the live run.

---

### Task 1: Setup and shell segment splitter

**Files:**

- Modify: `agent-eval/package.json` (add `diff` devDependency)
- Modify: `agent-eval/tsconfig.json` (include the new paths)
- Modify: `agent-eval/lib/shell-parse.ts:270` (export `tokenizeShellCommand`)
- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/shell-segments.ts`
- Test: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/shell-segments.test.ts`

**Interfaces:**

- Consumes: `tokenizeShellCommand(command: string): string[]` from `lib/shell-parse.ts` — a quote-aware tokenizer that emits `&&`, `||`, `;`, `|` as standalone tokens.
- Produces: `splitCommandSegments(command: string): ShellSegment[]` and the `ShellSegment` interface, both used by Task 2.

- [ ] **Step 1: Add the `diff` dependency and tsconfig includes**

```bash
cd /home/steve/Development/mcp/agent-eval && pnpm add -D diff@^8.0.2 @types/diff@^8.0.0
```

Then edit `agent-eval/tsconfig.json` — replace the `include` array with:

```json
	"include": [
		"eval.d.ts",
		"eval-matchers.d.ts",
		"experiments/**/*.ts",
		"evals/**/EVAL.ts",
		"evals/**/EVAL.tsx",
		"evals/**/post-analysis.ts",
		"evals/**/__analysis__/**/*.ts",
		"lib/**/*.ts",
		"vitest.config.ts"
	],
```

- [ ] **Step 2: Export the tokenizer**

In `agent-eval/lib/shell-parse.ts`, change line 270 from `function tokenizeShellCommand` to:

```ts
export function tokenizeShellCommand(command: string): string[] {
```

- [ ] **Step 3: Write the failing test**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/shell-segments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { splitCommandSegments } from './shell-segments.ts';

describe('splitCommandSegments', () => {
	it('returns one segment for a plain command', () => {
		expect(splitCommandSegments('ls /workspace/src')).toEqual([
			{ tokens: ['ls', '/workspace/src'], redirectsToFile: false, piped: false },
		]);
	});

	it('splits on &&, || and ;', () => {
		const segments = splitCommandSegments('ls a && cat b; grep c d');
		expect(segments.map((segment) => segment.tokens[0])).toEqual(['ls', 'cat', 'grep']);
		expect(segments.every((segment) => !segment.piped)).toBe(true);
	});

	it('marks segments downstream of a pipe', () => {
		const segments = splitCommandSegments('npx tsc --noEmit | tail -20');
		expect(segments).toHaveLength(2);
		expect(segments[0]?.piped).toBe(false);
		expect(segments[1]).toMatchObject({ tokens: ['tail', '-20'], piped: true });
	});

	it('only the segment immediately after a pipe is piped, not later ones', () => {
		const segments = splitCommandSegments('cat a | head -5; ls b');
		expect(segments.map((segment) => segment.piped)).toEqual([false, true, false]);
	});

	it('flags redirection to a file', () => {
		const segments = splitCommandSegments('cat > /tmp/out.txt');
		expect(segments[0]?.redirectsToFile).toBe(true);
	});

	it('does not treat 2>&1 as a file redirect', () => {
		const segments = splitCommandSegments('npx tsc 2>&1');
		expect(segments[0]?.redirectsToFile).toBe(false);
	});

	it('strips heredoc bodies so their contents are not parsed as commands', () => {
		const command =
			"cat > /tmp/t.tsx <<'EOF'\nimport { render } from 'x'\nrm -rf /\nEOF\nls /workspace";
		const segments = splitCommandSegments(command);
		expect(segments.some((segment) => segment.tokens[0] === 'rm')).toBe(false);
		expect(segments.some((segment) => segment.tokens[0] === 'ls')).toBe(true);
	});

	it('keeps a quoted sed expression as a single token', () => {
		const segments = splitCommandSegments("sed -i 's#a; b#c#' file.ts");
		expect(segments).toHaveLength(1);
		expect(segments[0]?.tokens).toEqual(['sed', '-i', 's#a; b#c#', 'file.ts']);
	});

	it('returns no segments for an empty command', () => {
		expect(splitCommandSegments('   ')).toEqual([]);
	});
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval shell-segments
```

Expected: FAIL — `Failed to resolve import "./shell-segments.ts"`.

- [ ] **Step 5: Implement the splitter**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/shell-segments.ts`:

```ts
// Split a shell command into independently classifiable segments.
//
// Compound commands are the norm in agent transcripts: a single Bash call
// routinely chains exploration, an edit and a verification run. Classifying
// the call as a whole would attribute all of it to one bucket, so the tool
// taxonomy needs the parts.
//
// The pipe distinction is the subtle one. `;`, `&&` and `||` separate
// independent commands, but `|` does not: `npx tsc | tail -20` is one act of
// verification whose output is filtered, not verification plus exploration.
// Counting the `tail` as exploration would inflate a lower-is-better metric
// every time an agent trimmed noisy output — penalising the careful ones.
import { tokenizeShellCommand } from '../../../lib/shell-parse.ts';

export interface ShellSegment {
	tokens: string[];
	/** A `>` or `>>` redirect into a path: a write regardless of head binary. */
	redirectsToFile: boolean;
	/** This segment consumes the previous segment's stdout. */
	piped: boolean;
}

const SEPARATORS = new Set(['&&', '||', ';', '|']);

// Heredoc bodies are data, not commands. Left in place, a payload containing
// `rm -rf /` would be tokenised and classified as an edit.
const HEREDOC = /<<-?\s*'?"?(\w+)'?"?[\s\S]*?^\1$/gm;

function stripHeredocBodies(command: string): string {
	return command.replace(HEREDOC, '<<HEREDOC');
}

// `2>&1` and `&>` duplicate a descriptor rather than naming a file; only a
// bare `>`/`>>` (optionally prefixed by a single digit) creates or truncates one.
const FILE_REDIRECT = /^\d?>>?$/;

export function splitCommandSegments(command: string): ShellSegment[] {
	const tokens = tokenizeShellCommand(stripHeredocBodies(command));
	const segments: ShellSegment[] = [];

	let current: string[] = [];
	let redirectsToFile = false;
	let piped = false;

	const flush = () => {
		if (current.length > 0) {
			segments.push({ tokens: current, redirectsToFile, piped });
		}
		current = [];
		redirectsToFile = false;
	};

	for (const token of tokens) {
		if (SEPARATORS.has(token)) {
			flush();
			piped = token === '|';
			continue;
		}
		if (FILE_REDIRECT.test(token)) {
			redirectsToFile = true;
			continue;
		}
		// An attached form such as `>/tmp/out` survives tokenisation as one token.
		if (/^\d?>>?[^&]/.test(token)) {
			redirectsToFile = true;
			continue;
		}
		current.push(token);
	}
	flush();

	return segments;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval shell-segments
```

Expected: PASS, 9 tests.

If the `2>&1` or heredoc tests fail, inspect what the tokenizer actually emits before changing the assertions:

```bash
cd /home/steve/Development/mcp/agent-eval && node -e "import('./lib/shell-parse.ts').then(m => console.log(m.tokenizeShellCommand('npx tsc 2>&1 | tail -20')))"
```

- [ ] **Step 7: Verify nothing else broke and commit**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval && pnpm format
git add agent-eval/package.json agent-eval/pnpm-lock.yaml pnpm-lock.yaml agent-eval/tsconfig.json agent-eval/lib/shell-parse.ts "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__"
git commit -m "feat(agent-eval): add shell command segment splitter

Splits compound shell commands so a single Bash call can be attributed to
several tool-use buckets. Segments after a pipe are marked so output
filters (| head, | tail) are not counted as codebase exploration."
```

---

### Task 2: Golden test fixture

**Files:**

- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/__fixtures__/golden-run/transcript.json`
- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/__fixtures__/golden-run/result.json`
- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/__fixtures__/README.md`

**Interfaces:**

- Produces: two committed JSON files consumed by the tests in Tasks 3, 4, 5 and 10.

**Why this is its own task:** `agent-eval/results/` is gitignored, so the captured run cannot be referenced from tests directly. Every later task's golden assertions depend on these files existing, and they must be generated once from a source that may later be deleted.

- [ ] **Step 1: Confirm the source run is still present**

```bash
cd /home/steve/Development/mcp/agent-eval && ls results/agentic-ref-reuse-component-cc-mcp-opus-high/opus/*/701-agentic-ref-reuse-component-mcp/run-1/result.json
```

Expected: one path printed. If missing, this plan's golden numbers cannot be reproduced — stop and re-run the eval, or skip the golden assertions in Tasks 3, 4, 5 and 10 and rely on the synthetic tests only.

- [ ] **Step 2: Generate the trimmed fixture**

```bash
cd /home/steve/Development/mcp/agent-eval && node -e "
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { globSync } = require('node:fs');
const [runDir] = globSync('results/agentic-ref-reuse-component-cc-mcp-opus-high/opus/*/701-agentic-ref-reuse-component-mcp/run-1');
const out = 'evals/701-agentic-ref-reuse-component-mcp/__analysis__/__fixtures__/golden-run';
mkdirSync(out, { recursive: true });

const transcript = JSON.parse(readFileSync(runDir + '/transcript.json', 'utf8'));
// tool_call events only, with the verbose \`raw\` field dropped: 142KB -> 21KB.
writeFileSync(out + '/transcript.json', JSON.stringify({
  agent: transcript.agent,
  model: transcript.model,
  summary: transcript.summary,
  events: transcript.events.filter((e) => e.type === 'tool_call').map((e) => ({
    type: e.type, timestamp: e.timestamp,
    tool: { name: e.tool.name, originalName: e.tool.originalName, args: e.tool.args },
  })),
}, null, 2) + '\n');

writeFileSync(out + '/result.json', readFileSync(runDir + '/result.json'));
console.log('written to', out);
"
```

- [ ] **Step 3: Verify the fixture carries the expected values**

```bash
cd /home/steve/Development/mcp/agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/__fixtures__/golden-run && node -e "
const t = require('./transcript.json'), r = require('./result.json');
console.log('tool_call events :', t.events.length, '(expect 25)');
console.log('duration         :', r.duration, '(expect 403.365)');
console.log('turns            :', r.o11y.totalTurns, '(expect 12)');
console.log('cost             :', r.metadata.usage.estimatedCostUsd, '(expect 1.89273325)');
"
```

Expected exactly:

```
tool_call events : 25 (expect 25)
duration         : 403.365 (expect 403.365)
turns            : 12 (expect 12)
cost             : 1.89273325 (expect 1.89273325)
```

- [ ] **Step 4: Document the fixture's provenance**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/__fixtures__/README.md`:

```markdown
# Test fixtures

## `golden-run/`

A real captured run, trimmed and committed so the metric modules have a
permanent regression target that costs nothing to re-derive. `results/` is
gitignored, so without this the numbers below would be unreproducible.

Source: experiment `agentic-ref-reuse-component-cc-mcp-opus-high`, model
`opus`, eval `701-agentic-ref-reuse-component-mcp`, run 1, captured
2026-07-28. External repo pinned at
`yannbf/mealdrop@ce507b345666ea8678101fccac580186b2b69b1f`.

`transcript.json` keeps only `tool_call` events, with each event's verbose
`raw` field dropped (142KB to 21KB). `result.json` is verbatim.

Measured values, asserted by the tests:

| Metric                | Value                                                   |
| --------------------- | ------------------------------------------------------- |
| duration              | 403.365s                                                |
| turns                 | 12                                                      |
| tool calls            | 25                                                      |
| estimated cost        | $1.89273325                                             |
| cache hit rate        | 0.8330                                                  |
| buckets               | docs 1, exploration 14, edit 8, verification 7, other 0 |
| edits to `Footer.tsx` | 3                                                       |
| SLoC (stripped)       | +9 / -1 across 1 file                                   |

The agent's entire change was 10 added and 1 removed physical line in
`src/components/Footer/Footer.tsx`, confirmed by diffing the pinned ref
against the collected `project/` tree. One of those added lines is blank, so
the comment- and blank-stripped SLoC figure the metric reports is +9 / -1.
```

- [ ] **Step 5: Commit**

```bash
cd /home/steve/Development/mcp
git add "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/__fixtures__"
git commit -m "test(agent-eval): add golden run fixture for metric regression tests

results/ is gitignored, so a trimmed copy of one real run is committed to
give every metric module a permanent, zero-cost regression target."
```

---

### Task 3: Tool-use taxonomy

**Files:**

- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/tool-taxonomy.ts`
- Test: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/tool-taxonomy.test.ts`

**Interfaces:**

- Consumes: `splitCommandSegments`, `ShellSegment` from `./shell-segments.ts` (Task 1); the golden fixture from Task 2.
- Produces: `classifyToolUse(events: unknown[]): ToolUseMetrics`, `classifyShellCommand(command: string): Bucket[]`, and types `Bucket`, `ToolUseMetrics` — used by Task 10.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/tool-taxonomy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import goldenTranscript from './__fixtures__/golden-run/transcript.json' with { type: 'json' };
import { classifyShellCommand, classifyToolUse } from './tool-taxonomy.ts';

describe('classifyShellCommand', () => {
	const cases: Array<[string, string[]]> = [
		['ls /workspace/src', ['exploration']],
		['find /workspace/src -iname "*footer*"', ['exploration']],
		['grep -rn "path=" src', ['exploration']],
		['cat src/components/Footer/Footer.tsx', ['exploration']],
		['npx tsc --noEmit -p tsconfig.json', ['verification']],
		['npx vitest run --config vitest.config.app.ts', ['verification']],
		['npx eslint src/a.tsx', ['verification']],
		['git status --short', ['verification']],
		['cp /tmp/a.tsx src/a.tsx', ['edit']],
		['rm -f src/tmp.test.ts', ['edit']],
		['mkdir -p src/new', ['edit']],
		// Output filters after a pipe are not exploration.
		['npx tsc --noEmit 2>&1 | tail -20', ['verification']],
		['npx vitest run 2>&1 | tail -25', ['verification']],
		['cat a.ts | head -30', ['exploration']],
		// Compound commands contribute to several buckets.
		['ls src/ && cat src/a.ts', ['exploration']],
		['rm -f tmp.ts; npx vitest run', ['edit', 'verification']],
		['rm -f tmp.ts && git status --short', ['edit', 'verification']],
		// sed is ambiguous: -i writes, otherwise it reads.
		["sed -i 's#a#b#' src/a.ts", ['edit']],
		["sed -n '1,20p' src/a.ts", ['exploration']],
		// Wrappers and env prefixes are stepped past to find the real binary.
		['NO_COLOR=1 npx tsc --noEmit', ['verification']],
		['pnpm run typecheck', ['other']],
		['yarn vitest run', ['verification']],
		// Redirects are writes regardless of head binary.
		['cat > /tmp/scratch.tsx', ['edit']],
		['echo hi > src/a.ts', ['edit']],
		// echo alone is noise, not a bucket.
		['echo "=== marker ==="', []],
	];

	for (const [command, expected] of cases) {
		it(`classifies \`${command}\` as ${expected.join('+') || '(none)'}`, () => {
			expect(classifyShellCommand(command).sort()).toEqual([...expected].sort());
		});
	}
});

describe('classifyToolUse', () => {
	it('buckets structured tool calls by normalised name', () => {
		const metrics = classifyToolUse([
			{ type: 'tool_call', tool: { name: 'file_read', originalName: 'Read', args: {} } },
			{ type: 'tool_call', tool: { name: 'grep', originalName: 'Grep', args: {} } },
			{ type: 'tool_call', tool: { name: 'file_edit', originalName: 'Edit', args: {} } },
			{ type: 'tool_call', tool: { name: 'web_fetch', originalName: 'WebFetch', args: {} } },
		]);
		expect(metrics.buckets).toEqual({
			docs: 1,
			exploration: 2,
			edit: 1,
			verification: 0,
			other: 0,
		});
	});

	it('counts any mcp__ tool as a documentation read', () => {
		const metrics = classifyToolUse([
			{
				type: 'tool_call',
				tool: {
					name: 'unknown',
					originalName: 'mcp__storybook-dev-mcp__get-documentation',
					args: {},
				},
			},
		]);
		expect(metrics.buckets.docs).toBe(1);
	});

	it('ignores non tool_call events', () => {
		const metrics = classifyToolUse([
			{ type: 'message', role: 'user', content: 'hi' },
			{ type: 'tool_result', content: 'ok' },
		]);
		expect(metrics.buckets).toEqual({
			docs: 0,
			exploration: 0,
			edit: 0,
			verification: 0,
			other: 0,
		});
	});

	it('records unrecognised shell heads for later triage', () => {
		const metrics = classifyToolUse([
			{
				type: 'tool_call',
				tool: { name: 'shell', originalName: 'Bash', args: { command: 'frobnicate --all' } },
			},
		]);
		expect(metrics.buckets.other).toBe(1);
		expect(metrics.unclassified).toEqual(['frobnicate']);
	});

	it('reproduces the golden run exactly', () => {
		const metrics = classifyToolUse(goldenTranscript.events);
		expect(metrics.buckets).toEqual({
			docs: 1,
			exploration: 14,
			edit: 8,
			verification: 7,
			other: 0,
		});
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval tool-taxonomy
```

Expected: FAIL — `Failed to resolve import "./tool-taxonomy.ts"`.

- [ ] **Step 3: Implement the taxonomy**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/tool-taxonomy.ts`:

```ts
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
	/** Shell heads that matched no rule, so the tables can grow from real data. */
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

/** Commands that do nothing measurable — pure output noise. */
const NOISE_BINARIES = new Set(['echo', 'true', 'false', 'printf', ':']);

const PACKAGE_RUNNERS = new Set(['npx', 'npm', 'pnpm', 'yarn', 'bun', 'bunx']);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Resolve the binary a segment actually invokes, stepping past `ENV=value`
 * prefixes and package-runner wrappers. `npx tsc` is a typecheck, not an npx.
 */
function resolveHead(tokens: string[]): { head: string; rest: string[] } {
	let index = 0;
	while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index] ?? '')) index += 1;

	let head = tokens[index] ?? '';
	if (PACKAGE_RUNNERS.has(head)) {
		index += 1;
		while (index < tokens.length && (tokens[index] ?? '').startsWith('-')) index += 1;
		// `pnpm run typecheck` names a script, not a binary; the script's contents
		// are not visible here, so it stays unclassified rather than guessed at.
		if (tokens[index] === 'exec') index += 1;
		head = tokens[index] ?? '';
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

/** Buckets a single shell command may contribute to. Deduplicated. */
export function classifyShellCommand(command: string): Bucket[] {
	const buckets = new Set<Bucket>();
	const unclassified: string[] = [];
	collectShellBuckets(command, buckets, unclassified);
	return [...buckets];
}

function collectShellBuckets(command: string, buckets: Set<Bucket>, unclassified: string[]): void {
	for (const segment of splitCommandSegments(command)) {
		// Downstream of a pipe: a filter on the previous command's output, not an
		// independent act. Without this, `npx tsc | tail -20` reads as exploration.
		if (segment.piped) continue;

		if (segment.redirectsToFile) {
			buckets.add('edit');
			continue;
		}

		const { bucket, head } = classifySegmentTokens(segment.tokens);
		if (bucket === null) continue;
		if (bucket === 'other' && head !== '') unclassified.push(head);
		buckets.add(bucket);
	}
}

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
		if (!isRecord(event) || event.type !== 'tool_call' || !isRecord(event.tool)) continue;
		const { name, originalName, args } = event.tool;

		// MCP tools surface as `unknown` with an `mcp__server__workflow` original
		// name; that prefix is the only reliable marker of a documentation call.
		if (typeof originalName === 'string' && originalName.startsWith('mcp__')) {
			buckets.docs += 1;
			continue;
		}

		if (name === 'shell') {
			const command = isRecord(args) && typeof args.command === 'string' ? args.command : '';
			const found = new Set<Bucket>();
			collectShellBuckets(command, found, unclassified);
			for (const bucket of found) buckets[bucket] += 1;
			continue;
		}

		const structured = typeof name === 'string' ? STRUCTURED_BUCKETS[name] : undefined;
		buckets[structured ?? 'other'] += 1;
	}

	return { buckets, unclassified };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval tool-taxonomy
```

Expected: PASS, 30 tests. The golden test asserting `{docs: 1, exploration: 14, edit: 8, verification: 7, other: 0}` is the one that matters most — it is the hand-verified classification of a real run.

If the golden test fails, print the per-call classification to find the disagreement:

```bash
cd /home/steve/Development/mcp/agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__ && node -e "
Promise.all([import('./tool-taxonomy.ts'), import('node:fs')]).then(([m, fs]) => {
  const t = JSON.parse(fs.readFileSync('./__fixtures__/golden-run/transcript.json', 'utf8'));
  t.events.forEach((e, i) => {
    const label = e.tool.name === 'shell'
      ? m.classifyShellCommand(e.tool.args.command ?? '').join('+')
      : e.tool.name;
    console.log(String(i + 1).padStart(2), label);
  });
});
"
```

- [ ] **Step 5: Commit**

```bash
cd /home/steve/Development/mcp && pnpm format
git add "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__"
git commit -m "feat(agent-eval): classify agent tool calls into five buckets

Adds docs/exploration/edit/verification/other classification with
compound-shell splitting. Verified against a real run: 25 calls resolve to
docs 1, exploration 14, edit 8, verification 7, other 0."
```

---

### Task 4: Per-file churn

**Files:**

- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/churn.ts`
- Test: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/churn.test.ts`

**Interfaces:**

- Consumes: `splitCommandSegments` from `./shell-segments.ts` (Task 1); the golden fixture from Task 2.
- Produces: `computeChurn(events: unknown[], workspaceRoot?: string): ChurnMetrics` and the `ChurnMetrics` interface — used by Task 10.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/churn.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import goldenTranscript from './__fixtures__/golden-run/transcript.json' with { type: 'json' };
import { computeChurn } from './churn.ts';

function edit(filePath: string) {
	return {
		type: 'tool_call',
		tool: { name: 'file_edit', originalName: 'Edit', args: { file_path: filePath } },
	};
}

function shell(command: string) {
	return { type: 'tool_call', tool: { name: 'shell', originalName: 'Bash', args: { command } } };
}

describe('computeChurn', () => {
	it('counts structured edits per file and strips the workspace prefix', () => {
		const churn = computeChurn([edit('/workspace/src/a.tsx'), edit('/workspace/src/a.tsx')]);
		expect(churn.perFile).toEqual({ 'src/a.tsx': 2 });
		expect(churn.filesEdited).toBe(1);
		expect(churn.maxEditsPerFile).toBe(2);
		expect(churn.meanEditsPerFile).toBe(2);
	});

	it('averages across several files', () => {
		const churn = computeChurn([
			edit('/workspace/a.ts'),
			edit('/workspace/a.ts'),
			edit('/workspace/b.ts'),
		]);
		expect(churn.filesEdited).toBe(2);
		expect(churn.maxEditsPerFile).toBe(2);
		expect(churn.meanEditsPerFile).toBe(1.5);
	});

	it('counts shell writes, which o11y.filesModified misses entirely', () => {
		const churn = computeChurn([shell("sed -i 's#a#b#' src/a.tsx")]);
		expect(churn.perFile).toEqual({ 'src/a.tsx': 1 });
	});

	it('counts a heredoc redirect as a write to its target', () => {
		const churn = computeChurn([shell("cat > src/new.tsx <<'EOF'\nconst a = 1\nEOF")]);
		expect(churn.perFile).toEqual({ 'src/new.tsx': 1 });
	});

	it('counts the destination of a copy, not the source', () => {
		const churn = computeChurn([shell('cp /tmp/scratch.tsx src/a.tsx')]);
		expect(churn.perFile).toEqual({ 'src/a.tsx': 1 });
	});

	it('ignores writes outside the workspace', () => {
		const churn = computeChurn([shell('cat > /tmp/scratch.tsx')]);
		expect(churn.perFile).toEqual({});
		expect(churn.filesEdited).toBe(0);
	});

	it('reports null rather than zero when nothing was edited', () => {
		const churn = computeChurn([]);
		expect(churn).toEqual({
			perFile: {},
			filesEdited: 0,
			maxEditsPerFile: null,
			meanEditsPerFile: null,
		});
	});

	it('reproduces the golden run exactly', () => {
		const churn = computeChurn(goldenTranscript.events);
		expect(churn.perFile['src/components/Footer/Footer.tsx']).toBe(3);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval churn
```

Expected: FAIL — `Failed to resolve import "./churn.ts"`.

- [ ] **Step 3: Implement churn**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/churn.ts`:

```ts
// How many times the agent rewrote each file. Fewer passes over the same file
// suggests it understood the change before making it.
//
// Shell writes must be counted, not just structured Edit/Write calls: the
// captured run edited via `cp` and `sed -i`, and `o11y.filesModified` lists
// only Footer.tsx as a result. Agents also differ in how much they reach for
// the shell, so ignoring it would bias any cross-agent comparison.
import { isRecord } from '../../../lib/shell-parse.ts';
import { splitCommandSegments } from './shell-segments.ts';

export interface ChurnMetrics {
	/** Workspace-relative path to number of write operations. */
	perFile: Record<string, number>;
	filesEdited: number;
	/** null when no file was edited — distinct from an average that came out 0. */
	maxEditsPerFile: number | null;
	meanEditsPerFile: number | null;
}

/** Binaries whose *last* path argument is the file being written. */
const WRITES_LAST_ARGUMENT = new Set(['cp', 'mv', 'tee', 'touch', 'ln']);
/** Binaries where every path argument is affected. */
const WRITES_EVERY_ARGUMENT = new Set(['rm', 'mkdir', 'chmod']);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const FILE_REDIRECT_WITH_TARGET = /^\d?>>?(.+)$/;

function isPathLike(token: string): boolean {
	return token !== '' && !token.startsWith('-');
}

function normalize(rawPath: string, workspaceRoot: string): string | null {
	const path = rawPath.replace(/^['"]|['"]$/g, '');
	if (path.startsWith(workspaceRoot)) return path.slice(workspaceRoot.length);
	// Absolute paths outside the workspace are scratch space (/tmp), not the
	// codebase under evaluation.
	if (path.startsWith('/')) return null;
	return path.replace(/^\.\//, '');
}

function collectShellWrites(command: string, workspaceRoot: string, into: string[]): void {
	for (const segment of splitCommandSegments(command)) {
		if (segment.piped) continue;

		let index = 0;
		const { tokens } = segment;
		while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index] ?? '')) index += 1;
		const head = (tokens[index] ?? '').replace(/^.*\//, '');
		const args = tokens.slice(index + 1);

		// `cmd > path` and `cmd >path` both name a redirect target.
		const attached = tokens
			.map((token) => FILE_REDIRECT_WITH_TARGET.exec(token)?.[1])
			.find(Boolean);
		if (attached !== undefined) {
			const target = normalize(attached, workspaceRoot);
			if (target !== null) into.push(target);
		}
		if (segment.redirectsToFile && attached === undefined) {
			// The tokenizer emitted `>` and its target separately; the target is the
			// token following it.
			const redirectIndex = tokens.findIndex((token) => /^\d?>>?$/.test(token));
			const target = redirectIndex >= 0 ? tokens[redirectIndex + 1] : undefined;
			if (target !== undefined) {
				const normalized = normalize(target, workspaceRoot);
				if (normalized !== null) into.push(normalized);
			}
		}

		if (head === 'sed' || head === 'awk') {
			if (!args.some((token) => token === '-i' || token.startsWith('-i'))) continue;
			// The last path-like argument is the file edited in place; the ones
			// before it are the script and its flags.
			const target = args.filter(isPathLike).at(-1);
			if (target !== undefined) {
				const normalized = normalize(target, workspaceRoot);
				if (normalized !== null) into.push(normalized);
			}
			continue;
		}

		if (WRITES_LAST_ARGUMENT.has(head)) {
			const target = args.filter(isPathLike).at(-1);
			if (target !== undefined) {
				const normalized = normalize(target, workspaceRoot);
				if (normalized !== null) into.push(normalized);
			}
			continue;
		}

		if (WRITES_EVERY_ARGUMENT.has(head)) {
			for (const token of args.filter(isPathLike)) {
				const normalized = normalize(token, workspaceRoot);
				if (normalized !== null) into.push(normalized);
			}
		}
	}
}

export function computeChurn(events: unknown[], workspaceRoot = '/workspace/'): ChurnMetrics {
	const written: string[] = [];

	for (const event of events) {
		if (!isRecord(event) || event.type !== 'tool_call' || !isRecord(event.tool)) continue;
		const { name, args } = event.tool;

		if ((name === 'file_edit' || name === 'file_write') && isRecord(args)) {
			const filePath = args.file_path;
			if (typeof filePath === 'string') {
				const normalized = normalize(filePath, workspaceRoot);
				if (normalized !== null) written.push(normalized);
			}
			continue;
		}

		if (name === 'shell' && isRecord(args) && typeof args.command === 'string') {
			collectShellWrites(args.command, workspaceRoot, written);
		}
	}

	const perFile: Record<string, number> = {};
	for (const path of written) perFile[path] = (perFile[path] ?? 0) + 1;

	const counts = Object.values(perFile);
	return {
		perFile,
		filesEdited: counts.length,
		maxEditsPerFile: counts.length === 0 ? null : Math.max(...counts),
		meanEditsPerFile:
			counts.length === 0 ? null : counts.reduce((sum, count) => sum + count, 0) / counts.length,
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval churn
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/steve/Development/mcp && pnpm format
git add "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__"
git commit -m "feat(agent-eval): count per-file edit iterations

Counts structured Edit/Write calls plus shell writes (sed -i, redirects,
cp, mv, tee). Shell detection matters: the captured run edited via cp and
sed -i, which o11y.filesModified does not report."
```

---

### Task 5: Speed and cost signals

**Files:**

- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/run-signals.ts`
- Test: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/run-signals.test.ts`

**Interfaces:**

- Consumes: the golden fixture from Task 2.
- Produces: `readSpeed(result: unknown): SpeedMetrics`, `readCost(result: unknown): CostMetrics`, and both interfaces — used by Task 10.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/run-signals.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import goldenResult from './__fixtures__/golden-run/result.json' with { type: 'json' };
import { readCost, readSpeed } from './run-signals.ts';

describe('readSpeed', () => {
	it('reads duration and turns from the golden run', () => {
		expect(readSpeed(goldenResult)).toEqual({ durationSeconds: 403.365, turns: 12 });
	});

	it('nulls missing fields rather than throwing', () => {
		expect(readSpeed({})).toEqual({ durationSeconds: null, turns: null });
		expect(readSpeed(null)).toEqual({ durationSeconds: null, turns: null });
	});
});

describe('readCost', () => {
	it('reads usage and derives the cache hit rate from the golden run', () => {
		const cost = readCost(goldenResult);
		expect(cost.inputTokens).toBe(53157);
		expect(cost.cacheWriteTokens).toBe(147365);
		expect(cost.cacheReadTokens).toBe(999884);
		expect(cost.outputTokens).toBe(8239);
		expect(cost.totalTokens).toBe(1208645);
		expect(cost.estimatedCostUsd).toBe(1.89273325);
		expect(cost.totalToolCalls).toBe(25);
		// cacheRead / (input + cacheWrite + cacheRead); output is excluded because
		// caching applies only to the input side.
		expect(cost.cacheHitRate).toBeCloseTo(0.833, 4);
	});

	it('nulls the cache hit rate when there are no input-side tokens', () => {
		const cost = readCost({
			metadata: {
				usage: {
					inputTokens: 0,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					outputTokens: 5,
					totalTokens: 5,
				},
			},
		});
		expect(cost.cacheHitRate).toBeNull();
	});

	it('nulls every field when usage is absent', () => {
		const cost = readCost({});
		expect(cost.totalTokens).toBeNull();
		expect(cost.cacheHitRate).toBeNull();
		expect(cost.estimatedCostUsd).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval run-signals
```

Expected: FAIL — `Failed to resolve import "./run-signals.ts"`.

- [ ] **Step 3: Implement the signal readers**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/run-signals.ts`:

```ts
// Speed and cost are already recorded by the harness; this module only reads
// them out of result.json and derives the one value that is missing.
//
// Everything here is defensive: an interrupted run can leave result.json
// without metadata, and a metric pass that throws on one bad run loses the
// good ones alongside it.
import { isRecord } from '../../../lib/shell-parse.ts';

export interface SpeedMetrics {
	durationSeconds: number | null;
	turns: number | null;
}

export interface CostMetrics {
	inputTokens: number | null;
	cacheWriteTokens: number | null;
	cacheReadTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	/** cacheRead / (input + cacheWrite + cacheRead). null when that sum is 0. */
	cacheHitRate: number | null;
	estimatedCostUsd: number | null;
	toolCalls: Record<string, number> | null;
	totalToolCalls: number | null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readSpeed(result: unknown): SpeedMetrics {
	const record = isRecord(result) ? result : {};
	const o11y = isRecord(record.o11y) ? record.o11y : {};
	return {
		durationSeconds: numberOrNull(record.duration),
		turns: numberOrNull(o11y.totalTurns),
	};
}

export function readCost(result: unknown): CostMetrics {
	const record = isRecord(result) ? result : {};
	const metadata = isRecord(record.metadata) ? record.metadata : {};
	const usage = isRecord(metadata.usage) ? metadata.usage : {};
	const o11y = isRecord(record.o11y) ? record.o11y : {};

	const inputTokens = numberOrNull(usage.inputTokens);
	const cacheWriteTokens = numberOrNull(usage.cacheWriteTokens);
	const cacheReadTokens = numberOrNull(usage.cacheReadTokens);

	const inputSide = (inputTokens ?? 0) + (cacheWriteTokens ?? 0) + (cacheReadTokens ?? 0);

	return {
		inputTokens,
		cacheWriteTokens,
		cacheReadTokens,
		outputTokens: numberOrNull(usage.outputTokens),
		totalTokens: numberOrNull(usage.totalTokens),
		cacheHitRate: inputSide === 0 ? null : (cacheReadTokens ?? 0) / inputSide,
		estimatedCostUsd: numberOrNull(usage.estimatedCostUsd),
		toolCalls: isRecord(o11y.toolCalls) ? (o11y.toolCalls as Record<string, number>) : null,
		totalToolCalls: numberOrNull(o11y.totalToolCalls),
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval run-signals
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/steve/Development/mcp && pnpm format
git add "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__"
git commit -m "feat(agent-eval): extract speed and cost signals from result.json

Reads duration, turns, token counts and tool-call totals, and derives the
cache hit rate over input-side tokens only. Missing fields yield null so a
partial result.json cannot abort the pass."
```

---

### Task 6: SLoC stripping

**Files:**

- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/sloc.ts`
- Test: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/sloc.test.ts`

**Interfaces:**

- Consumes: `typescript` (already a devDependency at 5.9.3).
- Produces: `stripToSloc(source: string, filename: string): string` and `SOURCE_EXTENSIONS: RegExp` — used by Task 7.

**Why a full parse rather than a scanner:** a raw token scan cannot tell a regex literal from division, so `const r = /https:\/\//` would have its trailing `//` mistaken for a comment start and the rest of the line deleted. Parsing first and reading comments as leading trivia avoids the ambiguity entirely.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/sloc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { countSloc, stripToSloc } from './sloc.ts';

describe('stripToSloc', () => {
	it('keeps plain code untouched', () => {
		expect(stripToSloc('const a = 1\nconst b = 2\n', 'a.ts')).toBe('const a = 1\nconst b = 2');
	});

	it('drops blank and whitespace-only lines', () => {
		expect(stripToSloc('const a = 1\n\n   \nconst b = 2\n', 'a.ts')).toBe(
			'const a = 1\nconst b = 2',
		);
	});

	it('drops whole-line comments', () => {
		expect(stripToSloc('// leading\nconst a = 1\n', 'a.ts')).toBe('const a = 1');
	});

	it('keeps code that has a trailing comment', () => {
		expect(stripToSloc('const a = 1 // why\n', 'a.ts')).toBe('const a = 1');
	});

	it('drops multi-line block comments entirely', () => {
		const source = '/**\n * docs\n * more docs\n */\nconst a = 1\n';
		expect(stripToSloc(source, 'a.ts')).toBe('const a = 1');
	});

	it('does not mistake // inside a string for a comment', () => {
		const source = "const url = 'https://example.com'\n";
		expect(stripToSloc(source, 'a.ts')).toBe(source.trimEnd());
	});

	it('does not mistake // inside a regex literal for a comment', () => {
		const source = 'const re = /https:\\/\\//\nconst a = 1\n';
		expect(countSloc(source, 'a.ts')).toBe(2);
	});

	it('does not mistake // inside a template literal for a comment', () => {
		const source = 'const t = `see //here`\nconst a = 1\n';
		expect(countSloc(source, 'a.ts')).toBe(2);
	});

	it('handles JSX and its comment syntax', () => {
		const source = 'const a = <div>\n  {/* a jsx comment */}\n  <span>hi</span>\n</div>\n';
		// The braces survive as code; only the comment text is removed.
		expect(countSloc(source, 'a.tsx')).toBe(4);
	});

	it('parses generic arrow functions in .ts as generics, not JSX', () => {
		const source = 'const identity = <T,>(value: T): T => value\n';
		expect(countSloc(source, 'a.ts')).toBe(1);
	});

	it('strips block comments from CSS', () => {
		const source = '.a {\n  /* a note */\n  color: red;\n}\n';
		expect(countSloc(source, 'a.css')).toBe(3);
	});

	it('returns the source unchanged for unknown extensions', () => {
		expect(stripToSloc('# a heading\n', 'README.md')).toBe('# a heading');
	});

	it('falls back to the raw text when a file cannot be parsed', () => {
		// Deliberately broken input must not throw; it is still diffable text.
		expect(() => stripToSloc('const = = =\n', 'a.ts')).not.toThrow();
	});
});

describe('countSloc', () => {
	it('counts remaining lines', () => {
		expect(countSloc('// c\n\nconst a = 1\nconst b = 2\n', 'a.ts')).toBe(2);
	});

	it('counts an empty file as zero', () => {
		expect(countSloc('', 'a.ts')).toBe(0);
		expect(countSloc('\n\n\n', 'a.ts')).toBe(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval sloc
```

Expected: FAIL — `Failed to resolve import "./sloc.ts"`.

- [ ] **Step 3: Implement the stripper**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/sloc.ts`:

```ts
// Strip comments and blank lines so the diff measures code, not prose.
//
// A ten-line JSDoc block is not ten lines of new logic, and an agent that
// documents its work should not score worse than one that does not. Both sides
// of the diff are stripped before comparison, so the resulting counts are
// source lines rather than physical ones.
//
// Comments are collected as leading trivia of parsed tokens rather than by
// scanning for `//`. A bare scan cannot distinguish a regex literal from
// division, so `const r = /https:\/\//` would lose the rest of its line.
import ts from 'typescript';

export const SOURCE_EXTENSIONS = /\.(?:tsx?|jsx?|mjs|cjs|css)$/;

const SCRIPT_EXTENSIONS = /\.(?:tsx?|jsx?|mjs|cjs)$/;
const CSS_EXTENSION = /\.css$/;
const CSS_BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

/**
 * `.tsx` and `.jsx` parse as JSX; `.ts` must not. Parsing a plain `.ts` file in
 * TSX mode makes a generic arrow function (`const f = <T>(x: T) => x`) read as
 * an unterminated JSX element. The ported walker had this bug; it is fixed here
 * and in cyclomatic.ts / cognitive.ts, which use the same rule.
 */
export function scriptKindFor(filename: string): ts.ScriptKind {
	if (filename.endsWith('.tsx')) return ts.ScriptKind.TSX;
	if (filename.endsWith('.jsx')) return ts.ScriptKind.JSX;
	if (filename.endsWith('.ts')) return ts.ScriptKind.TS;
	return ts.ScriptKind.JS;
}

/** Every comment in the file, as [start, end) offsets, deduplicated and sorted. */
function commentRanges(sourceFile: ts.SourceFile, text: string): Array<[number, number]> {
	const seen = new Map<number, number>();

	const visit = (node: ts.Node): void => {
		// Every comment is leading trivia of some token, including the EOF token,
		// so walking all tokens finds all comments.
		for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) {
			seen.set(range.pos, Math.max(seen.get(range.pos) ?? 0, range.end));
		}
		for (const child of node.getChildren(sourceFile)) visit(child);
	};

	visit(sourceFile);
	return [...seen.entries()].sort((a, b) => a[0] - b[0]);
}

function dropBlankLines(text: string): string {
	return text
		.split('\n')
		.filter((line) => line.trim() !== '')
		.join('\n');
}

export function stripToSloc(source: string, filename: string): string {
	if (CSS_EXTENSION.test(filename)) {
		return dropBlankLines(source.replace(CSS_BLOCK_COMMENT, ''));
	}

	if (!SCRIPT_EXTENSIONS.test(filename)) {
		return dropBlankLines(source);
	}

	let ranges: Array<[number, number]>;
	try {
		const sourceFile = ts.createSourceFile(
			filename,
			source,
			ts.ScriptTarget.Latest,
			/* setParentNodes */ true,
			scriptKindFor(filename),
		);
		ranges = commentRanges(sourceFile, source);
	} catch {
		// A file the agent left syntactically broken is still diffable text; losing
		// comment stripping is far better than losing the file from the metric.
		return dropBlankLines(source);
	}

	// Remove back to front so earlier offsets stay valid. Newlines inside a
	// removed block are preserved so surrounding lines do not merge.
	let text = source;
	for (const [start, end] of [...ranges].reverse()) {
		const removed = text.slice(start, end);
		text = text.slice(0, start) + removed.replace(/[^\n]/g, '') + text.slice(end);
	}

	return dropBlankLines(text);
}

export function countSloc(source: string, filename: string): number {
	const stripped = stripToSloc(source, filename);
	return stripped === '' ? 0 : stripped.split('\n').length;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval sloc
```

Expected: PASS, 15 tests.

If the JSX comment test disagrees, print what actually survives before adjusting the expectation — the goal is that the line count is stable, not that a specific string is produced:

```bash
cd /home/steve/Development/mcp/agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__ && node -e "
import('./sloc.ts').then((m) => {
  console.log(JSON.stringify(m.stripToSloc('const a = <div>\n  {/* c */}\n  <span>hi</span>\n</div>\n', 'a.tsx')));
});
"
```

- [ ] **Step 5: Commit**

```bash
cd /home/steve/Development/mcp && pnpm format
git add "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__"
git commit -m "feat(agent-eval): strip comments and blanks for SLoC counting

Uses a full TypeScript parse and reads comments as leading trivia, so a
regex literal containing // is not mistaken for a comment. Picks ScriptKind
by extension so generic arrows in .ts files do not parse as JSX."
```

---

### Task 7: Tree diff

**Files:**

- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/tree-diff.ts`
- Test: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/tree-diff.test.ts`

**Interfaces:**

- Consumes: `stripToSloc`, `SOURCE_EXTENSIONS` from `./sloc.ts` (Task 6); `diffLines` from `diff` (Task 1).
- Produces: `diffTrees(refDir: string, projectDir: string): TreeDiff`, `TreeDiff`, `SlocDiff`, `EXCLUDED_PATHS` — used by Tasks 10 and 11.

**Why an LCS diff:** we diff _stripped_ text, so `git diff --numstat` cannot be used. Comparing line-by-line without LCS would report every line after an insertion as changed.

**Why exclusions are mandatory:** the collected `project/` tree contains harness-injected files that no agent wrote (`EVAL.ts`, `PROMPT.md`, `__agent_eval__/`, `__metrics__/`, `.npmrc`, `package-lock.json`, `vitest.config*.ts`, and a mutated `package.json`), and every binary asset in it is UTF-8 corrupted by the copy-out path — `favicon.ico` grows from 14254 to 24506 bytes. Without the extension filter all 17 images read as changed.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/tree-diff.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { diffTrees } from './tree-diff.ts';

let root: string;

function tree(name: string, files: Record<string, string>): string {
	const dir = join(root, name);
	for (const [path, content] of Object.entries(files)) {
		const full = join(dir, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	mkdirSync(dir, { recursive: true });
	return dir;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'tree-diff-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('diffTrees', () => {
	it('reports no change for identical trees', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\n' });
		const after = tree('after', { 'src/a.ts': 'const a = 1\n' });
		expect(diffTrees(before, after)).toEqual({
			filesChanged: 0,
			files: [],
			sloc: { added: 0, removed: 0, net: 0 },
		});
	});

	it('counts added and removed lines in a modified file', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\nconst b = 2\n' });
		const after = tree('after', { 'src/a.ts': 'const a = 1\nconst c = 3\nconst d = 4\n' });
		const result = diffTrees(before, after);
		expect(result.files).toEqual(['src/a.ts']);
		expect(result.sloc).toEqual({ added: 2, removed: 1, net: 1 });
	});

	it('counts a new file as all-added', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\n' });
		const after = tree('after', {
			'src/a.ts': 'const a = 1\n',
			'src/b.ts': 'const b = 1\nconst c = 2\n',
		});
		expect(diffTrees(before, after).sloc).toEqual({ added: 2, removed: 0, net: 2 });
	});

	it('counts a deleted file as all-removed', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\nconst b = 2\n' });
		const after = tree('after', {});
		expect(diffTrees(before, after).sloc).toEqual({ added: 0, removed: 2, net: -2 });
	});

	it('ignores comment and blank-line churn', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\n' });
		const after = tree('after', { 'src/a.ts': '// explain\n\nconst a = 1\n\n' });
		expect(diffTrees(before, after)).toEqual({
			filesChanged: 0,
			files: [],
			sloc: { added: 0, removed: 0, net: 0 },
		});
	});

	it('ignores non-source files', () => {
		const before = tree('before', { 'README.md': 'old\n' });
		const after = tree('after', { 'README.md': 'new\nlines\n' });
		expect(diffTrees(before, after).filesChanged).toBe(0);
	});

	it('ignores harness-injected paths', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\n' });
		const after = tree('after', {
			'src/a.ts': 'const a = 1\n',
			'EVAL.ts': 'test("x", () => {})\n',
			'__agent_eval__/test-utils.ts': 'export const x = 1\n',
			'__metrics__/mcp-usage.json': '{}\n',
			'vitest.config.app.ts': 'export default {}\n',
		});
		expect(diffTrees(before, after)).toEqual({
			filesChanged: 0,
			files: [],
			sloc: { added: 0, removed: 0, net: 0 },
		});
	});

	it('ignores node_modules and .git', () => {
		const before = tree('before', {});
		const after = tree('after', {
			'node_modules/pkg/index.js': 'module.exports = 1\n',
			'.git/config': 'x\n',
		});
		expect(diffTrees(before, after).filesChanged).toBe(0);
	});

	it('returns sorted, workspace-relative paths', () => {
		const before = tree('before', {});
		const after = tree('after', { 'src/z.ts': 'const z = 1\n', 'src/a.ts': 'const a = 1\n' });
		expect(diffTrees(before, after).files).toEqual(['src/a.ts', 'src/z.ts']);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval tree-diff
```

Expected: FAIL — `Failed to resolve import "./tree-diff.ts"`.

- [ ] **Step 3: Implement the tree diff**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/tree-diff.ts`:

```ts
// Compare the pinned upstream ref against the collected post-run tree.
//
// This is the authoritative changed-file list, and the only one available. The
// harness cannot supply it: `generatedFiles` is a git diff against a commit
// taken before setup() materialises the external repo, so it contains the whole
// application; and `o11y.filesModified` is transcript-derived, so it misses
// every edit made through the shell.
//
// Both sides are comment- and blank-stripped before diffing, so the counts are
// source lines. That rules out `git diff --numstat`, which only sees the raw
// files, hence the LCS diff here.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { diffLines } from 'diff';

import { SOURCE_EXTENSIONS, stripToSloc } from './sloc.ts';

export interface SlocDiff {
	added: number;
	removed: number;
	net: number;
}

export interface TreeDiff {
	filesChanged: number;
	/** Workspace-relative paths, sorted. */
	files: string[];
	sloc: SlocDiff;
}

/** Directories never worth walking. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

/**
 * Files the harness injects into the collected tree that no agent authored.
 * Counting them would attribute several hundred lines of scaffolding to the run.
 */
export const EXCLUDED_PATHS = new Set([
	'EVAL.ts',
	'EVAL.tsx',
	'PROMPT.md',
	'.npmrc',
	'package.json',
	'package-lock.json',
	'yarn.lock',
	'pnpm-lock.yaml',
	'vitest.config.ts',
	'vitest.config.app.ts',
]);

const EXCLUDED_PREFIXES = ['__agent_eval__/', '__metrics__/', '__analysis__/'];

function isExcluded(path: string): boolean {
	if (EXCLUDED_PATHS.has(path)) return true;
	if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
	// Binary assets are UTF-8 corrupted by the copy-out path, so every one of
	// them would otherwise read as changed.
	return !SOURCE_EXTENSIONS.test(path);
}

/** Workspace-relative, POSIX-separated paths of every candidate source file. */
function collectSourceFiles(dir: string): Set<string> {
	const found = new Set<string>();
	if (!existsSync(dir)) return found;

	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(join(current, entry.name));
				continue;
			}
			const path = relative(dir, join(current, entry.name)).split(sep).join('/');
			if (!isExcluded(path)) found.add(path);
		}
	};

	walk(dir);
	return found;
}

function readStripped(dir: string, path: string): string {
	const full = join(dir, path);
	if (!existsSync(full)) return '';
	try {
		return stripToSloc(readFileSync(full, 'utf8'), path);
	} catch {
		return '';
	}
}

function countLines(text: string): number {
	return text === '' ? 0 : text.split('\n').length;
}

export function diffTrees(refDir: string, projectDir: string): TreeDiff {
	const candidates = new Set([...collectSourceFiles(refDir), ...collectSourceFiles(projectDir)]);

	const files: string[] = [];
	let added = 0;
	let removed = 0;

	for (const path of candidates) {
		const before = readStripped(refDir, path);
		const after = readStripped(projectDir, path);
		if (before === after) continue;

		let fileAdded = 0;
		let fileRemoved = 0;
		// diffLines needs trailing newlines to treat the last line consistently.
		for (const change of diffLines(
			before === '' ? '' : before + '\n',
			after === '' ? '' : after + '\n',
		)) {
			const lines = countLines(change.value.replace(/\n$/, ''));
			if (change.added) fileAdded += lines;
			else if (change.removed) fileRemoved += lines;
		}

		if (fileAdded === 0 && fileRemoved === 0) continue;
		files.push(path);
		added += fileAdded;
		removed += fileRemoved;
	}

	files.sort();
	return { filesChanged: files.length, files, sloc: { added, removed, net: added - removed } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval tree-diff
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Verify against the real run**

This is the end-to-end check that the diff reports the agent's actual change: 10 added, 1 removed, in one file.

```bash
rm -rf /tmp/sloc-check && mkdir -p /tmp/sloc-check && \
curl -fsSL "https://codeload.github.com/yannbf/mealdrop/tar.gz/ce507b345666ea8678101fccac580186b2b69b1f" -o /tmp/sloc-check/ref.tgz && \
mkdir -p /tmp/sloc-check/ref && tar xzf /tmp/sloc-check/ref.tgz --strip-components=1 -C /tmp/sloc-check/ref && \
node -e "
import('./evals/701-agentic-ref-reuse-component-mcp/__analysis__/tree-diff.ts').then(async (m) => {
  const { globSync } = await import('node:fs');
  const [project] = globSync('results/agentic-ref-reuse-component-cc-mcp-opus-high/opus/*/701-agentic-ref-reuse-component-mcp/run-1/project');
  console.log(JSON.stringify(m.diffTrees('/tmp/sloc-check/ref', project), null, 2));
});
"
```

Expected:

```json
{
	"filesChanged": 1,
	"files": ["src/components/Footer/Footer.tsx"],
	"sloc": { "added": 9, "removed": 1, "net": 8 }
}
```

If `filesChanged` is larger than 1, print the extra paths and extend `EXCLUDED_PATHS` — the harness may inject files this plan did not anticipate. If it is 0, the ref download or the project glob failed.

- [ ] **Step 6: Commit**

```bash
cd /home/steve/Development/mcp && pnpm format
git add "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__"
git commit -m "feat(agent-eval): diff the pinned ref against the collected project tree

Produces the authoritative changed-file list and a comment-stripped SLoC
delta. The harness cannot supply this: generatedFiles predates external-repo
materialisation, and o11y.filesModified misses shell edits. Harness-injected
paths and non-source files are excluded, the latter because every binary in
the collected tree is UTF-8 corrupted."
```

---

### Task 8: Cyclomatic complexity walker

**Files:**

- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/cyclomatic.ts`
- Test: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/cyclomatic.test.ts`

**Interfaces:**

- Consumes: `scriptKindFor` from `./sloc.ts` (Task 6); `typescript`.
- Produces: `complexityForSource(filename: string, source: string): FunctionComplexity[]` and `FunctionComplexity` — used by Tasks 10 and 11.

**Provenance:** ported from storybookjs/storybook#35141, branch `sidnioulz/mvc-script-and-skill`, file `scripts/sustainability/assess-mvc/cost-benefit/utils/cyclomatic.ts`. It is dead code in that PR — nothing imports it but its own test — so this is a well-formed leaf module, not a proven integration. Two defects are fixed on port, and the four original tests are carried over verbatim so the ported semantics stay pinned.

**Defects fixed relative to the original:**

1. The original parsed _every_ file as `ts.ScriptKind.TSX`, so a generic arrow function in a plain `.ts` file (`const f = <T>(x: T) => x`) parsed as unterminated JSX. Now uses `scriptKindFor`.
2. The original did not treat `ConstructorDeclaration`, `GetAccessor` or `SetAccessor` as function-likes, so their bodies were attributed to an enclosing function or dropped. Now included.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/cyclomatic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { complexityForSource } from './cyclomatic.ts';

describe('complexityForSource', () => {
	// --- the four tests carried over verbatim from storybookjs/storybook#35141 ---
	it('returns 1 for a function with no branches', () => {
		expect(complexityForSource('a.ts', 'function a(){ return 1; }')).toEqual([
			{ name: 'a', complexity: 1 },
		]);
	});

	it('adds 1 per if/for/while/case/&&/||/?', () => {
		const source = `function f(x:number){
      if (x>0 && x<10) return 1;
      for (let i=0;i<x;i++){}
      switch(x){ case 1: case 2: return 2; default: return 3; }
      return x ? 1 : 0;
    }`;
		// 1 base + if + && + for + 2 cases + ternary = 7. `i<x` is a comparison,
		// correctly not counted; `default:` is correctly not counted.
		expect(complexityForSource('f.ts', source)).toEqual([{ name: 'f', complexity: 7 }]);
	});

	it('finds arrow functions and methods', () => {
		const source = `
      export const g = (x:number)=> x>0 ? 1 : 0;
      class C { m(){ if(true){} } }
    `;
		const result = complexityForSource('f.ts', source).sort((a, b) => a.name.localeCompare(b.name));
		expect(result).toEqual([
			{ name: 'C.m', complexity: 2 },
			{ name: 'g', complexity: 2 },
		]);
	});

	it('returns [] for non-JS/TS files', () => {
		expect(complexityForSource('readme.md', '# hi')).toEqual([]);
	});

	// --- regressions for the two defects fixed on port ---
	it('parses a generic arrow in .ts as a generic, not JSX', () => {
		const result = complexityForSource('a.ts', 'const identity = <T,>(value: T): T => value;');
		expect(result).toEqual([{ name: 'identity', complexity: 1 }]);
	});

	it('still parses JSX in .tsx', () => {
		const source = 'export const C = () => <div>{cond ? <a/> : <b/>}</div>;';
		expect(complexityForSource('a.tsx', source)).toEqual([{ name: 'C', complexity: 2 }]);
	});

	it('reports constructors, getters and setters as their own functions', () => {
		const source = `class C {
      constructor(x: number) { if (x) this.x = x; }
      get value() { return this.x ? 1 : 0; }
      set value(v: number) { this.x = v; }
    }`;
		const result = complexityForSource('a.ts', source).sort((a, b) => a.name.localeCompare(b.name));
		expect(result).toEqual([
			{ name: 'C.constructor', complexity: 2 },
			{ name: 'C.value', complexity: 2 },
			{ name: 'C.value', complexity: 1 },
		]);
	});

	it('does not double-count a nested function into its parent', () => {
		const source = `function outer(x: number) {
      if (x) {}
      function inner(y: number) { if (y) {} if (y > 1) {} }
      return inner;
    }`;
		const result = complexityForSource('a.ts', source).sort((a, b) => a.name.localeCompare(b.name));
		expect(result).toEqual([
			{ name: 'inner', complexity: 3 },
			{ name: 'outer', complexity: 2 },
		]);
	});

	it('counts ?? alongside && and ||', () => {
		expect(complexityForSource('a.ts', 'function f(a,b){ return a ?? b; }')).toEqual([
			{ name: 'f', complexity: 2 },
		]);
	});

	it('returns [] rather than throwing on unparseable input', () => {
		expect(() => complexityForSource('a.ts', 'function ( { { {')).not.toThrow();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval cyclomatic
```

Expected: FAIL — `Failed to resolve import "./cyclomatic.ts"`.

- [ ] **Step 3: Implement the walker**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/cyclomatic.ts`:

```ts
// Cyclomatic complexity per function: decision points plus one.
//
// Ported from storybookjs/storybook#35141
// (scripts/sustainability/assess-mvc/cost-benefit/utils/cyclomatic.ts). The two
// repositories are expected to merge later, at which point this and its
// original should be deduplicated.
//
// Two defects were fixed on port: the original parsed every file as TSX, so
// generic arrows in .ts mis-parsed as JSX; and it omitted constructors and
// accessors from its notion of a function, so their bodies were misattributed.
//
// Reported alongside cognitive complexity rather than alone. Cyclomatic charges
// every function a cost of entry of 1, so an agent that extracts three trivial
// helpers scores +3 without having made anything harder to read.
import ts from 'typescript';

import { scriptKindFor } from './sloc.ts';

export interface FunctionComplexity {
	name: string;
	complexity: number;
}

const SCRIPT_EXTENSIONS = /\.(?:tsx?|jsx?|mjs|cjs)$/;

function isFunctionLike(node: ts.Node): boolean {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isConstructorDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	);
}

function enclosingClassName(node: ts.Node): string | undefined {
	let current: ts.Node | undefined = node.parent;
	while (current) {
		if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
			return current.name?.text ?? 'Anon';
		}
		current = current.parent;
	}
	return undefined;
}

function memberName(node: ts.Node, fallback: string): string {
	const named = node as { name?: ts.Node };
	const raw =
		named.name && (ts.isIdentifier(named.name) || ts.isStringLiteral(named.name))
			? named.name.text
			: fallback;
	const className = enclosingClassName(node);
	return className ? `${className}.${raw}` : raw;
}

function nameOfFunctionLike(node: ts.Node): string | undefined {
	if (ts.isFunctionDeclaration(node)) return node.name?.text;
	if (ts.isConstructorDeclaration(node)) {
		const className = enclosingClassName(node);
		return className ? `${className}.constructor` : 'constructor';
	}
	if (ts.isMethodDeclaration(node)) return memberName(node, 'method');
	if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
		return memberName(node, 'accessor');
	}
	if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
		const parent = node.parent;
		if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
			return parent.name.text;
		}
		if (
			parent &&
			ts.isPropertyAssignment(parent) &&
			(ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))
		) {
			return parent.name.text;
		}
		if (parent && ts.isPropertyDeclaration(parent)) return memberName(parent, 'property');
	}
	return undefined;
}

const DECISION_KINDS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.IfStatement,
	ts.SyntaxKind.ForStatement,
	ts.SyntaxKind.ForInStatement,
	ts.SyntaxKind.ForOfStatement,
	ts.SyntaxKind.WhileStatement,
	ts.SyntaxKind.DoStatement,
	ts.SyntaxKind.CaseClause,
	ts.SyntaxKind.ConditionalExpression,
	ts.SyntaxKind.CatchClause,
]);

const SHORT_CIRCUIT_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
	ts.SyntaxKind.QuestionQuestionToken,
]);

export function complexityForSource(filename: string, source: string): FunctionComplexity[] {
	if (!SCRIPT_EXTENSIONS.test(filename)) return [];

	let sourceFile: ts.SourceFile;
	try {
		sourceFile = ts.createSourceFile(
			filename,
			source,
			ts.ScriptTarget.Latest,
			/* setParentNodes */ true,
			scriptKindFor(filename),
		);
	} catch {
		return [];
	}

	const results: FunctionComplexity[] = [];

	const measure = (functionNode: ts.Node, name: string): void => {
		let complexity = 1;

		const walk = (node: ts.Node): void => {
			if (DECISION_KINDS.has(node.kind)) {
				complexity += 1;
			} else if (
				ts.isBinaryExpression(node) &&
				SHORT_CIRCUIT_OPERATORS.has(node.operatorToken.kind)
			) {
				complexity += 1;
			}

			// Stop at nested function boundaries: each is measured separately, so
			// counting its decisions here would double-count them.
			if (node !== functionNode && isFunctionLike(node)) return;
			ts.forEachChild(node, walk);
		};

		walk(functionNode);
		results.push({ name, complexity });
	};

	const visit = (node: ts.Node): void => {
		if (isFunctionLike(node)) measure(node, nameOfFunctionLike(node) ?? '<anonymous>');
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return results;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval cyclomatic
```

Expected: PASS, 10 tests. The four ported tests must pass unmodified — if one fails, the port has changed the original semantics and the walker is wrong, not the test.

- [ ] **Step 5: Commit**

```bash
cd /home/steve/Development/mcp && pnpm format
git add "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__"
git commit -m "feat(agent-eval): port cyclomatic complexity walker

Ported from storybookjs/storybook#35141, keeping its four unit tests
verbatim. Fixes two defects on port: every file was parsed as TSX (breaking
generic arrows in .ts), and constructors and accessors were not treated as
functions."
```

---

### Task 9: Cognitive complexity walker

**Files:**

- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/cognitive.ts`
- Test: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/cognitive.test.ts`

**Interfaces:**

- Consumes: `scriptKindFor` from `./sloc.ts` (Task 6); `FunctionComplexity` from `./cyclomatic.ts` (Task 8); `typescript`.
- Produces: `cognitiveForSource(filename: string, source: string): FunctionComplexity[]` — used by Tasks 10 and 11.

**Why this exists:** cognitive complexity is the headline measure. Cyclomatic charges +1 per function merely for existing, so an agent adding three trivial helpers looks worse; cognitive charges zero cost of entry and weights nesting instead. SonarQube enables its cognitive rule (S3776) by default and leaves the cyclomatic one (S1541) off.

**Algorithm** (Sonar white paper, Appendix B). Reference implementation: `eslint-plugin-sonarjs/src/rules/cognitive-complexity.ts`.

- Base score is **0**, not 1 — there is no cost of entry.
- **+1 plus current nesting depth** for: `if`, ternary, `switch`, `for`, `for-in`, `for-of`, `while`, `do`, `catch`.
- **+1 with no nesting penalty** for: an `else` or `else if` clause, and each _sequence_ of like binary logical operators.
- **Nesting depth increases** inside those structures and inside nested function bodies.
- An `else if` does **not** increase depth for its own branches beyond its parent's — it reads as a flat chain, not nesting.
- A sequence of like operators counts once: `a && b && c` is +1, `a && b || c` is +2.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/cognitive.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { cognitiveForSource } from './cognitive.ts';

function scoreOf(source: string, name: string, filename = 'a.ts'): number | undefined {
	return cognitiveForSource(filename, source).find((entry) => entry.name === name)?.complexity;
}

describe('cognitiveForSource', () => {
	it('charges nothing for entering a function', () => {
		expect(scoreOf('function a(){ return 1; }', 'a')).toBe(0);
	});

	it('charges 1 for a single if', () => {
		expect(scoreOf('function a(x){ if (x) return 1; return 0; }', 'a')).toBe(1);
	});

	it('charges nesting: a nested if costs more than a flat one', () => {
		const source = 'function a(x,y){ if (x) { if (y) { return 1; } } return 0; }';
		// outer if +1 (depth 0), inner if +1+1 (depth 1) = 3
		expect(scoreOf(source, 'a')).toBe(3);
	});

	it('charges three levels of nesting cumulatively', () => {
		const source = 'function a(x,y,z){ if (x) { if (y) { if (z) { return 1; } } } return 0; }';
		// +1, +2, +3 = 6
		expect(scoreOf(source, 'a')).toBe(6);
	});

	it('charges a switch once regardless of case count', () => {
		const source = `function a(n){
      switch (n) { case 1: return 'one'; case 2: return 'two'; default: return 'lots'; }
    }`;
		expect(scoreOf(source, 'a')).toBe(1);
	});

	it('charges else and else-if without a nesting penalty', () => {
		const source = `function a(x){
      if (x === 1) return 1;
      else if (x === 2) return 2;
      else return 3;
    }`;
		// if +1, else-if +1, else +1 = 3, all flat
		expect(scoreOf(source, 'a')).toBe(3);
	});

	it('charges a run of like operators once', () => {
		expect(scoreOf('function a(b,c,d){ if (b && c && d) return 1; return 0; }', 'a')).toBe(2);
	});

	it('charges each distinct operator run separately', () => {
		expect(scoreOf('function a(b,c,d){ if (b && c || d) return 1; return 0; }', 'a')).toBe(3);
	});

	it('charges loops and catch with nesting', () => {
		const source = `function a(items){
      for (const item of items) { try { use(item); } catch (e) { report(e); } }
    }`;
		// for +1 (depth 0), catch +1+1 (depth 1) = 3
		expect(scoreOf(source, 'a')).toBe(3);
	});

	it('charges a ternary', () => {
		expect(scoreOf('function a(x){ return x ? 1 : 0; }', 'a')).toBe(1);
	});

	it('matches the white paper sumOfPrimes example', () => {
		const source = `function sumOfPrimes(max) {
      let total = 0;
      OUT: for (let i = 1; i <= max; ++i) {
        for (let j = 2; j < i; ++j) {
          if (i % j === 0) {
            continue OUT;
          }
        }
        total += i;
      }
      return total;
    }`;
		// for +1, nested for +2, if +3, labelled continue +1 = 7
		expect(scoreOf(source, 'sumOfPrimes')).toBe(7);
	});

	it('scores nested functions separately and counts their nesting', () => {
		const source = `function outer(x) {
      if (x) {}
      const inner = (y) => { if (y) { if (y > 1) {} } };
      return inner;
    }`;
		expect(scoreOf(source, 'outer')).toBe(1);
		// The arrow is measured on its own, from depth 0.
		expect(scoreOf(source, 'inner')).toBe(3);
	});

	it('returns [] for non-script files', () => {
		expect(cognitiveForSource('a.md', '# hi')).toEqual([]);
	});

	it('returns [] rather than throwing on unparseable input', () => {
		expect(() => cognitiveForSource('a.ts', 'function ( { { {')).not.toThrow();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval cognitive
```

Expected: FAIL — `Failed to resolve import "./cognitive.ts"`.

- [ ] **Step 3: Implement the walker**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/cognitive.ts`:

```ts
// Cognitive complexity per function, following Sonar's specification
// (https://www.sonarsource.com/docs/CognitiveComplexity.pdf, Appendix B).
// Reference implementation: eslint-plugin-sonarjs/src/rules/cognitive-complexity.ts.
//
// This is the headline complexity measure. Unlike cyclomatic complexity it
// charges no cost of entry for a function, so extracting a helper does not
// inflate the score, and it weights nesting, so a triply-nested conditional
// costs more than three flat ones. Sonar enables the cognitive rule (S3776) by
// default and leaves the cyclomatic one (S1541) off.
//
// Deliberately not implemented: recursion detection, which needs name
// resolution the single-file parse does not have. It is rare in the component
// code these evals touch.
import ts from 'typescript';

import type { FunctionComplexity } from './cyclomatic.ts';
import { scriptKindFor } from './sloc.ts';

const SCRIPT_EXTENSIONS = /\.(?:tsx?|jsx?|mjs|cjs)$/;

function isFunctionLike(node: ts.Node): boolean {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isConstructorDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	);
}

function enclosingClassName(node: ts.Node): string | undefined {
	let current: ts.Node | undefined = node.parent;
	while (current) {
		if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
			return current.name?.text ?? 'Anon';
		}
		current = current.parent;
	}
	return undefined;
}

function nameOfFunctionLike(node: ts.Node): string {
	const withClass = (raw: string): string => {
		const className = enclosingClassName(node);
		return className ? `${className}.${raw}` : raw;
	};

	if (ts.isFunctionDeclaration(node)) return node.name?.text ?? '<anonymous>';
	if (ts.isConstructorDeclaration(node)) return withClass('constructor');
	if (
		ts.isMethodDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	) {
		const name = node.name;
		return withClass(
			name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : 'member',
		);
	}
	const parent = node.parent;
	if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
		return parent.name.text;
	}
	if (
		parent &&
		ts.isPropertyAssignment(parent) &&
		(ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))
	) {
		return parent.name.text;
	}
	return '<anonymous>';
}

/** Structures that cost 1 plus the current nesting depth, and deepen it. */
function isNestingStructure(node: ts.Node): boolean {
	return (
		ts.isForStatement(node) ||
		ts.isForInStatement(node) ||
		ts.isForOfStatement(node) ||
		ts.isWhileStatement(node) ||
		ts.isDoStatement(node) ||
		ts.isSwitchStatement(node) ||
		ts.isCatchClause(node) ||
		ts.isConditionalExpression(node)
	);
}

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
	ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * A run of like operators costs 1, not 1 per operator: `a && b && c` reads as
 * one condition. The AST nests as `(a && b) && c`, so only the outermost node
 * of a run — one whose parent is not the same operator — is charged.
 */
function startsOperatorRun(node: ts.BinaryExpression): boolean {
	const parent = node.parent;
	return !(
		parent &&
		ts.isBinaryExpression(parent) &&
		parent.operatorToken.kind === node.operatorToken.kind
	);
}

/** An `if` that is the `else` branch of another `if` — a flat chain, not nesting. */
function isElseIf(node: ts.IfStatement): boolean {
	const parent = node.parent;
	return Boolean(parent && ts.isIfStatement(parent) && parent.elseStatement === node);
}

export function cognitiveForSource(filename: string, source: string): FunctionComplexity[] {
	if (!SCRIPT_EXTENSIONS.test(filename)) return [];

	let sourceFile: ts.SourceFile;
	try {
		sourceFile = ts.createSourceFile(
			filename,
			source,
			ts.ScriptTarget.Latest,
			/* setParentNodes */ true,
			scriptKindFor(filename),
		);
	} catch {
		return [];
	}

	const results: FunctionComplexity[] = [];

	const measure = (functionNode: ts.Node, name: string): void => {
		let complexity = 0;

		const walk = (node: ts.Node, depth: number): void => {
			// Nested functions are measured on their own, from depth 0.
			if (node !== functionNode && isFunctionLike(node)) return;

			if (ts.isIfStatement(node)) {
				// An `else if` costs 1 flat; a fresh `if` costs 1 plus its depth.
				const elseIf = isElseIf(node);
				complexity += elseIf ? 1 : 1 + depth;
				const branchDepth = elseIf ? depth : depth + 1;

				walk(node.expression, depth);
				walk(node.thenStatement, branchDepth);

				if (node.elseStatement) {
					if (ts.isIfStatement(node.elseStatement)) {
						// Charged by its own visit as an else-if; keep the same depth.
						walk(node.elseStatement, branchDepth);
					} else {
						complexity += 1; // a plain `else`, no nesting penalty
						walk(node.elseStatement, branchDepth);
					}
				}
				return;
			}

			if (isNestingStructure(node)) {
				complexity += 1 + depth;
				ts.forEachChild(node, (child) => walk(child, depth + 1));
				return;
			}

			if (ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind)) {
				if (startsOperatorRun(node)) complexity += 1;
			}

			// A labelled break or continue is a jump out of normal flow: +1 flat.
			if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label !== undefined) {
				complexity += 1;
			}

			ts.forEachChild(node, (child) => walk(child, depth));
		};

		walk(functionNode, 0);
		results.push({ name, complexity });
	};

	const visit = (node: ts.Node): void => {
		if (isFunctionLike(node)) measure(node, nameOfFunctionLike(node));
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return results;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval cognitive
```

Expected: PASS, 14 tests.

The `sumOfPrimes` case is the important one — it is the white paper's own worked example and pins the nesting arithmetic. If it reports 6 or 8 instead of 7, print the per-node contributions to find which increment is wrong rather than adjusting the expectation:

```bash
cd /home/steve/Development/mcp/agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__ && node -e "
import('./cognitive.ts').then((m) => {
  console.log(m.cognitiveForSource('a.ts', 'function f(x,y){ if (x) { if (y) {} } }'));  // expect 3
  console.log(m.cognitiveForSource('a.ts', 'function f(x){ if(x) {} else if (x) {} else {} }'));  // expect 3
});
"
```

- [ ] **Step 5: Commit**

```bash
cd /home/steve/Development/mcp && pnpm format
git add "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__"
git commit -m "feat(agent-eval): add cognitive complexity walker

Implements Sonar's cognitive complexity: no cost of entry per function, and
a nesting penalty. Unlike cyclomatic it does not penalise an agent for
extracting helpers, which is the behaviour these evals most often see.
Verified against the white paper's sumOfPrimes example."
```

---

### Task 10: External ref cache and complexity baseline

**Files:**

- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/external-ref.ts`
- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/baseline.ts`
- Test: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/baseline.test.ts`

**Interfaces:**

- Consumes: `complexityForSource` (Task 8), `cognitiveForSource` (Task 9), `SOURCE_EXTENSIONS` (Task 6), `EXCLUDED_PATHS` (Task 7).
- Produces: `prepareRef(cacheDir, repo, ref): string`, `validPin(value): ExternalRepoPin | null`, `loadOrBuildBaseline(baselineDir, refDir, pin): Baseline`, `baselineKey(pin): string`, `complexityForFiles(dir, files): FileComplexity`, and types `Baseline`, `FileComplexity` — used by Task 11.

**Why a committed baseline:** parsing ~200 source files on both sides of every run is wasteful when the "before" side only changes when the pin moves. Keyed by `repo@sha`, so a moved pin produces a cache miss rather than silently reusing stale numbers. `.eval-cache/` is gitignored but `evals/**` is not, so baselines under `__analysis__/baselines/` are committed and CI never recomputes them.

`external-ref.ts` moves the ref-fetching logic out of `scripts/analyze-results.mjs`, which becomes eval-agnostic in Task 12.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/baseline.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { baselineKey, complexityForFiles, loadOrBuildBaseline } from './baseline.ts';
import { validPin } from './external-ref.ts';

let root: string;

function writeTree(name: string, files: Record<string, string>): string {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		const full = join(dir, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	return dir;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'baseline-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('validPin', () => {
	it('accepts a well-formed pin', () => {
		expect(validPin({ repo: 'yannbf/mealdrop', ref: 'abc123' })).toEqual({
			repo: 'yannbf/mealdrop',
			ref: 'abc123',
		});
	});

	it('rejects shell-unsafe or malformed values', () => {
		expect(validPin({ repo: 'a b', ref: 'x' })).toBeNull();
		expect(validPin({ repo: 'a/b', ref: '$(id)' })).toBeNull();
		expect(validPin({ repo: 'a/b' })).toBeNull();
		expect(validPin(null)).toBeNull();
	});
});

describe('baselineKey', () => {
	it('escapes separators so the key is a single filename', () => {
		expect(baselineKey({ repo: 'yannbf/mealdrop', ref: 'heads/main' })).toBe(
			'yannbf__mealdrop@heads__main',
		);
	});
});

describe('complexityForFiles', () => {
	it('sums both measures across the given files', () => {
		const dir = writeTree('src', {
			'a.ts': 'function a(x){ if (x) return 1; return 0; }\n',
			'b.ts': 'function b(){ return 1; }\n',
		});
		// a: cyclomatic 2, cognitive 1. b: cyclomatic 1, cognitive 0.
		expect(complexityForFiles(dir, ['a.ts', 'b.ts'])).toEqual({
			cyclomatic: 3,
			cognitive: 1,
			parseFailures: [],
		});
	});

	it('scores a missing file as zero without failing', () => {
		const dir = writeTree('src', { 'a.ts': 'function a(){ return 1; }\n' });
		expect(complexityForFiles(dir, ['a.ts', 'gone.ts'])).toEqual({
			cyclomatic: 1,
			cognitive: 0,
			parseFailures: [],
		});
	});

	it('records a file it cannot parse rather than scoring it zero', () => {
		const dir = writeTree('src', { 'broken.ts': 'function ( { { {\n' });
		const result = complexityForFiles(dir, ['broken.ts']);
		expect(result.parseFailures).toEqual(['broken.ts']);
	});

	it('ignores non-script files', () => {
		const dir = writeTree('src', { 'a.css': '.a { color: red; }\n' });
		expect(complexityForFiles(dir, ['a.css'])).toEqual({
			cyclomatic: 0,
			cognitive: 0,
			parseFailures: [],
		});
	});
});

describe('loadOrBuildBaseline', () => {
	const pin = { repo: 'owner/name', ref: 'deadbeef' };

	it('builds and writes a baseline on first call', () => {
		const refDir = writeTree('ref', {
			'src/a.ts': 'function a(x){ if (x) return 1; return 0; }\n',
			'README.md': '# ignored\n',
		});
		const baselineDir = join(root, 'baselines');

		const baseline = loadOrBuildBaseline(baselineDir, refDir, pin);
		expect(baseline.files['src/a.ts']).toEqual({ cyclomatic: 2, cognitive: 1 });
		expect(baseline.files['README.md']).toBeUndefined();
		expect(existsSync(join(baselineDir, 'owner__name@deadbeef.json'))).toBe(true);
	});

	it('reads the cached baseline without touching the ref tree again', () => {
		const baselineDir = join(root, 'baselines');
		mkdirSync(baselineDir, { recursive: true });
		writeFileSync(
			join(baselineDir, 'owner__name@deadbeef.json'),
			JSON.stringify({
				repo: 'owner/name',
				ref: 'deadbeef',
				files: { 'src/a.ts': { cyclomatic: 9, cognitive: 9 } },
			}),
		);

		// A nonexistent ref directory proves the cached copy was used.
		const baseline = loadOrBuildBaseline(baselineDir, join(root, 'no-such-dir'), pin);
		expect(baseline.files['src/a.ts']).toEqual({ cyclomatic: 9, cognitive: 9 });
	});

	it('rebuilds when the pin moves, because the key changes', () => {
		const refDir = writeTree('ref', { 'src/a.ts': 'function a(){ return 1; }\n' });
		const baselineDir = join(root, 'baselines');

		loadOrBuildBaseline(baselineDir, refDir, pin);
		loadOrBuildBaseline(baselineDir, refDir, { repo: 'owner/name', ref: 'cafe' });

		expect(existsSync(join(baselineDir, 'owner__name@deadbeef.json'))).toBe(true);
		expect(existsSync(join(baselineDir, 'owner__name@cafe.json'))).toBe(true);
	});

	it('writes stable, sorted JSON so committed baselines diff cleanly', () => {
		const refDir = writeTree('ref', {
			'src/z.ts': 'function z(){ return 1; }\n',
			'src/a.ts': 'function a(){ return 1; }\n',
		});
		const baselineDir = join(root, 'baselines');
		loadOrBuildBaseline(baselineDir, refDir, pin);

		const written = readFileSync(join(baselineDir, 'owner__name@deadbeef.json'), 'utf8');
		expect(Object.keys(JSON.parse(written).files)).toEqual(['src/a.ts', 'src/z.ts']);
		expect(written.endsWith('\n')).toBe(true);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --project agent-eval baseline
```

Expected: FAIL — `Failed to resolve import "./baseline.ts"`.

- [ ] **Step 3: Implement the ref cache**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/external-ref.ts`:

```ts
// Fetch and cache the pinned upstream ref this eval measures against.
//
// Moved out of scripts/analyze-results.mjs, which is now eval-agnostic: which
// repository to fetch is 701's business, not the runner's.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface ExternalRepoPin {
	repo: string;
	ref: string;
}

/** Keeps interpolated values shell-safe; mirrors lib/agentic-reference/external-repo.ts. */
const SAFE_GITHUB_PATH = /^[\w./-]+$/;

export function validPin(value: unknown): ExternalRepoPin | null {
	if (typeof value !== 'object' || value === null) return null;
	const { repo, ref } = value as { repo?: unknown; ref?: unknown };
	if (typeof repo !== 'string' || !SAFE_GITHUB_PATH.test(repo)) return null;
	if (typeof ref !== 'string' || !SAFE_GITHUB_PATH.test(ref)) return null;
	return { repo, ref };
}

/**
 * A single directory name for a pin. Both halves have their separators escaped:
 * SAFE_GITHUB_PATH admits refs like `heads/main`, which unescaped would turn the
 * slug into a nested path. SHA pins contain no separator, so existing cache
 * directories keep their names.
 */
export function pinSlug({ repo, ref }: ExternalRepoPin): string {
	return `${repo.replace(/\//g, '__')}@${ref.replace(/\//g, '__')}`;
}

const cache = new Map<string, string>();

/**
 * Download and extract a ref, returning its directory. Extraction happens in a
 * scratch directory that is renamed into place only once it fully succeeded: a
 * half-populated cache directory would be trusted forever and would quietly
 * skew every later diff.
 */
export function prepareRef(cacheDir: string, repo: string, ref: string): string {
	const slug = pinSlug({ repo, ref });
	const cached = cache.get(slug);
	if (cached !== undefined) return cached;

	const dir = join(cacheDir, slug);
	if (!existsSync(dir)) {
		mkdirSync(cacheDir, { recursive: true });
		const scratch = `${dir}.partial-${process.pid}`;
		rmSync(scratch, { recursive: true, force: true });
		mkdirSync(scratch, { recursive: true });
		try {
			// execFile, not a shell: repo and ref never reach a command line.
			const tarball = join(scratch, 'source.tar.gz');
			execFileSync('curl', [
				'-fsSL',
				'-o',
				tarball,
				`https://codeload.github.com/${repo}/tar.gz/${ref}`,
			]);
			// --strip-components=1 drops the tarball's top-level <name>-<ref>/ dir.
			execFileSync('tar', ['xzf', tarball, '--strip-components=1', '-C', scratch]);
			rmSync(tarball);
			renameSync(scratch, dir);
		} catch (error) {
			rmSync(scratch, { recursive: true, force: true });
			throw new Error(
				`Failed to fetch ${repo}@${ref}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	cache.set(slug, dir);
	return dir;
}
```

- [ ] **Step 4: Implement the baseline**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/baseline.ts`:

```ts
// Precomputed whole-repo complexity for a pinned ref, keyed by repo@sha.
//
// The "before" side of a complexity diff only changes when the pin moves, so
// parsing ~200 files on every run of every experiment is wasted work. Keying by
// sha means a moved pin misses the cache rather than silently reusing numbers
// from a different tree.
//
// Baselines live under evals/ rather than .eval-cache/ because .eval-cache/ is
// gitignored; committing them means CI never recomputes and a reviewer can see
// the baseline change when a pin moves.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { cognitiveForSource } from './cognitive.ts';
import { complexityForSource } from './cyclomatic.ts';
import type { ExternalRepoPin } from './external-ref.ts';
import { pinSlug } from './external-ref.ts';

export interface FileComplexity {
	cyclomatic: number;
	cognitive: number;
}

export interface Baseline {
	repo: string;
	ref: string;
	/** Workspace-relative path to that file's summed complexity. */
	files: Record<string, FileComplexity>;
}

export interface ComplexityTotals extends FileComplexity {
	/** Files that could not be parsed, so a real 0 is distinguishable from a miss. */
	parseFailures: string[];
}

const SCRIPT_EXTENSIONS = /\.(?:tsx?|jsx?|mjs|cjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

export function baselineKey(pin: ExternalRepoPin): string {
	return pinSlug(pin);
}

function sum(entries: Array<{ complexity: number }>): number {
	return entries.reduce((total, entry) => total + entry.complexity, 0);
}

/**
 * Summed complexity for one file. Returns null when the file exists but yields
 * no functions *and* failed to parse — the caller uses that to separate a
 * genuine zero from a walker that gave up.
 */
function scoreFile(dir: string, path: string): FileComplexity | 'unparseable' | null {
	const full = join(dir, path);
	if (!existsSync(full) || !SCRIPT_EXTENSIONS.test(path)) return null;

	let source: string;
	try {
		source = readFileSync(full, 'utf8');
	} catch {
		return null;
	}

	const cyclomaticEntries = complexityForSource(path, source);
	const cognitiveEntries = cognitiveForSource(path, source);

	// A non-trivial file that yields no functions at all is the signature of a
	// parse failure: the walkers swallow their errors and return [].
	if (
		cyclomaticEntries.length === 0 &&
		source.trim().length > 0 &&
		/\bfunction\b|=>/.test(source)
	) {
		return 'unparseable';
	}

	return { cyclomatic: sum(cyclomaticEntries), cognitive: sum(cognitiveEntries) };
}

/** Summed complexity across a specific set of files in a tree. */
export function complexityForFiles(dir: string, files: string[]): ComplexityTotals {
	let cyclomatic = 0;
	let cognitive = 0;
	const parseFailures: string[] = [];

	for (const path of files) {
		const score = scoreFile(dir, path);
		if (score === null) continue;
		if (score === 'unparseable') {
			parseFailures.push(path);
			continue;
		}
		cyclomatic += score.cyclomatic;
		cognitive += score.cognitive;
	}

	return { cyclomatic, cognitive, parseFailures };
}

function collectScriptFiles(dir: string): string[] {
	const found: string[] = [];
	if (!existsSync(dir)) return found;

	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(join(current, entry.name));
				continue;
			}
			const path = relative(dir, join(current, entry.name)).split(sep).join('/');
			if (SCRIPT_EXTENSIONS.test(path)) found.push(path);
		}
	};

	walk(dir);
	return found.sort();
}

export function loadOrBuildBaseline(
	baselineDir: string,
	refDir: string,
	pin: ExternalRepoPin,
): Baseline {
	const path = join(baselineDir, `${baselineKey(pin)}.json`);

	if (existsSync(path)) {
		try {
			return JSON.parse(readFileSync(path, 'utf8')) as Baseline;
		} catch {
			// A truncated baseline is worse than none; fall through and rebuild.
		}
	}

	const files: Record<string, FileComplexity> = {};
	// Sorted so the committed JSON diffs cleanly when a pin moves.
	for (const file of collectScriptFiles(refDir)) {
		const score = scoreFile(refDir, file);
		if (score === null || score === 'unparseable') continue;
		files[file] = score;
	}

	const baseline: Baseline = { repo: pin.repo, ref: pin.ref, files };
	mkdirSync(baselineDir, { recursive: true });
	writeFileSync(path, JSON.stringify(baseline, null, 2) + '\n');
	return baseline;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval baseline
```

Expected: PASS, 12 tests.

- [ ] **Step 6: Generate and commit the real baseline**

```bash
cd /home/steve/Development/mcp/agent-eval && node -e "
Promise.all([
  import('./evals/701-agentic-ref-reuse-component-mcp/__analysis__/external-ref.ts'),
  import('./evals/701-agentic-ref-reuse-component-mcp/__analysis__/baseline.ts'),
]).then(([ref, baseline]) => {
  const pin = { repo: 'yannbf/mealdrop', ref: 'ce507b345666ea8678101fccac580186b2b69b1f' };
  const dir = ref.prepareRef('.eval-cache/refs', pin.repo, pin.ref);
  const built = baseline.loadOrBuildBaseline(
    'evals/701-agentic-ref-reuse-component-mcp/__analysis__/baselines', dir, pin);
  const files = Object.keys(built.files);
  console.log('files scored:', files.length);
  console.log('total cyclomatic:', Object.values(built.files).reduce((s, f) => s + f.cyclomatic, 0));
  console.log('total cognitive :', Object.values(built.files).reduce((s, f) => s + f.cognitive, 0));
  console.log('Footer.tsx      :', JSON.stringify(built.files['src/components/Footer/Footer.tsx']));
});
"
```

Expected: a file count in the low hundreds, non-zero totals, and a `Footer.tsx` entry. If `files scored` is 0 the ref download failed. Record the printed `Footer.tsx` numbers — Task 11's golden test needs them.

```bash
cd /home/steve/Development/mcp && pnpm format
git add "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__"
git commit -m "feat(agent-eval): cache the pinned ref and precompute its complexity baseline

Baselines are keyed by repo@sha and committed under evals/, so a moved pin
misses the cache rather than reusing stale numbers, and CI never recomputes.
Moves ref fetching out of the analyzer script, which is about to become
eval-agnostic."
```

---

### Task 11: The post-analysis hook

**Files:**

- Create: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/post-analysis.ts`
- Test: `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/post-analysis.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 3–10.
- Produces: `analyzeRun(ctx: PostAnalysisContext)`, `summarize(rows)`, `renderTables(rows, summary)`, and the `PostAnalysisContext` interface — the contract Task 12's gateway calls.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/post-analysis.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import goldenResult from './__fixtures__/golden-run/result.json' with { type: 'json' };
import goldenTranscript from './__fixtures__/golden-run/transcript.json' with { type: 'json' };
import { analyzeRun, summarize } from '../post-analysis.ts';

let root: string;

function writeTree(name: string, files: Record<string, string>): string {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		const full = join(dir, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	return dir;
}

function context(overrides: Record<string, unknown> = {}) {
	// resolveRefDir is injected by default so the suite never downloads the real
	// 20MB ref; tests that care about the diff supply both trees explicitly.
	const defaultRef = writeTree('default-ref', { 'src/a.ts': 'function a(){ return 0; }\n' });
	return {
		resolveRefDir: () => defaultRef,
		runDir: join(root, 'run'),
		projectDir: writeTree('project', {
			'src/a.ts': 'function a(x){ if (x) return 1; return 0; }\n',
		}),
		fixtureDir: join(root, 'fixture'),
		experiment: 'agentic-ref-reuse-component-cc-mcp-opus-high',
		model: 'opus',
		timestamp: '2026-07-28T12-21-43.772Z',
		evalName: '701-agentic-ref-reuse-component-mcp',
		run: 1,
		result: goldenResult,
		readTranscript: () => goldenTranscript,
		...overrides,
	};
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'post-analysis-'));
	mkdirSync(join(root, 'run'), { recursive: true });
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('analyzeRun', () => {
	it('reports the golden run speed, cost and tool-use figures', async () => {
		const row = await analyzeRun(context());

		expect(row?.speed).toEqual({ durationSeconds: 403.365, turns: 12 });
		expect(row?.cost).toMatchObject({
			inputTokens: 53157,
			outputTokens: 8239,
			totalTokens: 1208645,
			estimatedCostUsd: 1.89273325,
			totalToolCalls: 25,
		});
		expect((row?.cost as { cacheHitRate: number }).cacheHitRate).toBeCloseTo(0.833, 4);
		expect(row?.toolUse).toMatchObject({
			buckets: { docs: 1, exploration: 14, edit: 8, verification: 7, other: 0 },
		});
		expect((row?.churn as { perFile: Record<string, number> }).perFile).toEqual({
			'src/components/Footer/Footer.tsx': 3,
		});
	});

	it('carries run identity through to the record', async () => {
		const row = await analyzeRun(context());
		expect(row).toMatchObject({
			experiment: 'agentic-ref-reuse-component-cc-mcp-opus-high',
			eval: '701-agentic-ref-reuse-component-mcp',
			run: 1,
			model: 'opus',
			status: 'failed',
		});
	});

	it('nulls transcript metrics when the transcript is unreadable', async () => {
		const row = await analyzeRun(
			context({
				readTranscript: () => {
					throw new Error('missing');
				},
			}),
		);
		expect(row?.toolUse).toBeNull();
		expect(row?.churn).toBeNull();
		// Non-transcript metrics still computed.
		expect(row?.speed).toEqual({ durationSeconds: 403.365, turns: 12 });
	});

	it('nulls densityPerSloc when no lines changed', async () => {
		// Identical ref and project trees: sloc.net is 0, so the ratio has no
		// denominator. resolveRefDir keeps this offline and deterministic.
		const identical = 'function a(x){ if (x) return 1; return 0; }\n';
		const refDir = writeTree('ref', { 'src/a.ts': identical });
		const row = await analyzeRun(
			context({
				projectDir: writeTree('same', { 'src/a.ts': identical }),
				resolveRefDir: () => refDir,
			}),
		);
		const complexity = row?.complexity as { densityPerSloc: number | null } | null;
		expect(complexity?.densityPerSloc ?? null).toBeNull();
		expect((row?.diff as { sloc: { net: number } }).sloc.net).toBe(0);
	});

	it('returns null when the run records no usable pin', async () => {
		const row = await analyzeRun(context({ result: { status: 'failed' } }));
		expect(row).toBeNull();
	});

	it('writes analysis.json next to result.json', async () => {
		const ctx = context();
		await analyzeRun(ctx);
		const written = JSON.parse(readFileSync(join(ctx.runDir, 'analysis.json'), 'utf8'));
		expect(written.speed.turns).toBe(12);
	});
});

describe('summarize', () => {
	it('groups by experiment and eval, and reports means', () => {
		const rows = [
			{
				experiment: 'x',
				eval: 'e',
				status: 'passed',
				cost: { estimatedCostUsd: 1 },
				speed: { durationSeconds: 10 },
				toolUse: { buckets: { docs: 2, exploration: 4 } },
			},
			{
				experiment: 'x',
				eval: 'e',
				status: 'failed',
				cost: { estimatedCostUsd: 3 },
				speed: { durationSeconds: 20 },
				toolUse: { buckets: { docs: 0, exploration: 8 } },
			},
		];
		const [group] = summarize(rows as never);
		expect(group).toMatchObject({ experiment: 'x', eval: 'e', runs: 2, passed: 1 });
		expect((group as { costUsd: { total: number } }).costUsd.total).toBe(4);
		expect((group as { durationSeconds: { mean: number } }).durationSeconds.mean).toBe(15);
	});

	it('reports null cost rather than zero when no run priced', () => {
		const rows = [
			{
				experiment: 'x',
				eval: 'e',
				status: 'passed',
				cost: { estimatedCostUsd: null },
				speed: {},
				toolUse: null,
			},
		];
		const [group] = summarize(rows as never);
		expect((group as { costUsd: { total: number | null } }).costUsd.total).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --project agent-eval post-analysis
```

Expected: FAIL — `Failed to resolve import "../post-analysis.ts"`.

- [ ] **Step 3: Implement the hook**

Create `agent-eval/evals/701-agentic-ref-reuse-component-mcp/post-analysis.ts`:

```ts
// Post-run analysis for the agentic-reference reuse-component eval.
//
// Loaded by scripts/analyze-results.mjs, which knows only this module's
// exported shape. Everything specific to this eval — which repository it
// measures against, which metrics matter — lives here and under __analysis__/.
//
// This file and __analysis__/ are excluded from sandbox uploads via
// IGNORED_PATTERNS in patches/@vercel__agent-eval@1.2.0.patch. Without that,
// the agent under evaluation could read the definitions of the metrics scoring
// it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { baselineKey, complexityForFiles, loadOrBuildBaseline } from './__analysis__/baseline.ts';
import { computeChurn } from './__analysis__/churn.ts';
import { prepareRef, validPin } from './__analysis__/external-ref.ts';
import type { ExternalRepoPin } from './__analysis__/external-ref.ts';
import { readCost, readSpeed } from './__analysis__/run-signals.ts';
import { diffTrees } from './__analysis__/tree-diff.ts';
import { classifyToolUse } from './__analysis__/tool-taxonomy.ts';

export interface PostAnalysisContext {
	runDir: string;
	projectDir: string;
	fixtureDir: string;
	experiment: string;
	model: string;
	timestamp: string;
	evalName: string;
	run: number;
	/** Parsed result.json. */
	result: unknown;
	/** Parsed transcript.json. Throws when absent; callers must handle it. */
	readTranscript: () => unknown;
	/**
	 * Resolve the pinned ref to a local directory. Injectable so tests can supply
	 * a fixture tree instead of downloading 20MB from GitHub; the gateway leaves
	 * it unset and gets the real cache.
	 */
	resolveRefDir?: (pin: ExternalRepoPin) => string;
}

const REF_CACHE_DIR = new URL('../../.eval-cache/refs', import.meta.url).pathname;
const BASELINE_DIR = new URL('./__analysis__/baselines', import.meta.url).pathname;

const SCRIPT_EXTENSIONS = /\.(?:tsx?|jsx?|mjs|cjs)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pinOf(result: unknown): ExternalRepoPin | null {
	const record = isRecord(result) ? result : {};
	const analysis = isRecord(record.analysis) ? record.analysis : {};
	return validPin(analysis.externalRepo);
}

function transcriptEvents(readTranscript: () => unknown): unknown[] | null {
	try {
		const transcript = readTranscript();
		return isRecord(transcript) && Array.isArray(transcript.events) ? transcript.events : null;
	} catch {
		// An interrupted run can leave no transcript. Tree metrics still work.
		return null;
	}
}

export async function analyzeRun(
	context: PostAnalysisContext,
): Promise<Record<string, unknown> | null> {
	const pin = pinOf(context.result);
	// A run that recorded no pin cannot be measured against anything; the
	// fixture's current pin may have moved since, which would silently change
	// every historical delta.
	if (pin === null) return null;

	const resolveRefDir =
		context.resolveRefDir ?? ((target) => prepareRef(REF_CACHE_DIR, target.repo, target.ref));
	const refDir = resolveRefDir(pin);
	const diff = diffTrees(refDir, context.projectDir);

	const changedScripts = diff.files.filter((file) => SCRIPT_EXTENSIONS.test(file));
	const baseline = loadOrBuildBaseline(BASELINE_DIR, refDir, pin);

	const before = changedScripts.reduce(
		(totals, file) => {
			const entry = baseline.files[file];
			return {
				cyclomatic: totals.cyclomatic + (entry?.cyclomatic ?? 0),
				cognitive: totals.cognitive + (entry?.cognitive ?? 0),
			};
		},
		{ cyclomatic: 0, cognitive: 0 },
	);
	const after = complexityForFiles(context.projectDir, changedScripts);

	const cognitiveDelta = after.cognitive - before.cognitive;
	const events = transcriptEvents(context.readTranscript);

	const record = {
		experiment: context.experiment,
		eval: context.evalName,
		run: context.run,
		model: context.model,
		timestamp: context.timestamp,
		fixtureRef: `${pin.repo}@${pin.ref.slice(0, 12)}`,
		status: isRecord(context.result) ? (context.result.status ?? null) : null,

		speed: readSpeed(context.result),
		cost: readCost(context.result),

		toolUse: events === null ? null : classifyToolUse(events),
		churn: events === null ? null : computeChurn(events),

		diff,

		complexity: {
			cyclomatic: {
				before: before.cyclomatic,
				after: after.cyclomatic,
				delta: after.cyclomatic - before.cyclomatic,
			},
			cognitive: {
				before: before.cognitive,
				after: after.cognitive,
				delta: cognitiveDelta,
			},
			// Complexity correlates ~0.9 with lines of code, so a bare delta partly
			// re-measures verbosity. null rather than Infinity when nothing changed:
			// a stored Infinity would poison every later mean.
			densityPerSloc: diff.sloc.net === 0 ? null : cognitiveDelta / diff.sloc.net,
			parseFailures: after.parseFailures,
			baselineKey: baselineKey(pin),
		},
	};

	writeFileSync(join(context.runDir, 'analysis.json'), JSON.stringify(record, null, 2) + '\n');
	return record;
}

function mean(values: number[]): number | null {
	return values.length === 0
		? null
		: values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number | null, digits = 2): number | null {
	return value === null ? null : Number(value.toFixed(digits));
}

function numbersAt(rows: Array<Record<string, unknown>>, read: (row: never) => unknown): number[] {
	return rows.flatMap((row) => {
		const value = read(row as never);
		return typeof value === 'number' && Number.isFinite(value) ? [value] : [];
	});
}

export function summarize(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	const groups = new Map<string, Array<Record<string, unknown>>>();
	for (const row of rows) {
		const key = `${String(row.experiment)}::${String(row.eval)}`;
		const existing = groups.get(key);
		if (existing) existing.push(row);
		else groups.set(key, [row]);
	}

	return [...groups.values()].map((group) => {
		const costs = numbersAt(
			group,
			(row) => (row as { cost?: { estimatedCostUsd?: number } }).cost?.estimatedCostUsd,
		);
		const durations = numbersAt(
			group,
			(row) => (row as { speed?: { durationSeconds?: number } }).speed?.durationSeconds,
		);
		const docs = numbersAt(
			group,
			(row) => (row as { toolUse?: { buckets?: { docs?: number } } }).toolUse?.buckets?.docs,
		);
		const exploration = numbersAt(
			group,
			(row) =>
				(row as { toolUse?: { buckets?: { exploration?: number } } }).toolUse?.buckets?.exploration,
		);
		const slocAdded = numbersAt(
			group,
			(row) => (row as { diff?: { sloc?: { added?: number } } }).diff?.sloc?.added,
		);
		const cognitiveDelta = numbersAt(
			group,
			(row) =>
				(row as { complexity?: { cognitive?: { delta?: number } } }).complexity?.cognitive?.delta,
		);

		// An aggregate silently spanning two pins is not one measurement.
		const fixtureRefs = [...new Set(group.map((row) => String(row.fixtureRef)))];

		return {
			experiment: group[0]?.experiment,
			eval: group[0]?.eval,
			fixtureRefs,
			runs: group.length,
			passed: group.filter((row) => row.status === 'passed').length,
			// null rather than 0 when nothing priced, so an unpriced model does not
			// read as a free one.
			costUsd: {
				total: costs.length === 0 ? null : round(costs.reduce((sum, cost) => sum + cost, 0)),
				reported: costs.length,
			},
			durationSeconds: { mean: round(mean(durations)) },
			docCalls: { mean: round(mean(docs)) },
			explorationCalls: { mean: round(mean(exploration)) },
			slocAdded: { mean: round(mean(slocAdded)) },
			cognitiveDelta: { mean: round(mean(cognitiveDelta)) },
		};
	});
}

export function renderTables(
	rows: Array<Record<string, unknown>>,
	summary: Array<Record<string, unknown>>,
): void {
	console.table(
		rows.map((row) => ({
			experiment: String(row.experiment).replace(/^agentic-ref-/, ''),
			run: row.run,
			status: row.status,
			seconds: (row.speed as { durationSeconds?: number })?.durationSeconds ?? null,
			turns: (row.speed as { turns?: number })?.turns ?? null,
			costUsd: (row.cost as { estimatedCostUsd?: number })?.estimatedCostUsd ?? null,
			docs: (row.toolUse as { buckets?: { docs?: number } })?.buckets?.docs ?? null,
			explore:
				(row.toolUse as { buckets?: { exploration?: number } })?.buckets?.exploration ?? null,
			slocAdded: (row.diff as { sloc?: { added?: number } })?.sloc?.added ?? null,
			cognitive: (row.complexity as { cognitive?: { delta?: number } })?.cognitive?.delta ?? null,
		})),
	);

	console.table(
		summary.map((group) => ({
			experiment: String(group.experiment).replace(/^agentic-ref-/, ''),
			fixtureRef:
				(group.fixtureRefs as string[]).length === 1
					? (group.fixtureRefs as string[])[0]
					: `mixed (${(group.fixtureRefs as string[]).length})`,
			runs: group.runs,
			passed: group.passed,
			costUsd: (group.costUsd as { total: number | null }).total,
			secondsMean: (group.durationSeconds as { mean: number | null }).mean,
			docsMean: (group.docCalls as { mean: number | null }).mean,
			exploreMean: (group.explorationCalls as { mean: number | null }).mean,
			slocMean: (group.slocAdded as { mean: number | null }).mean,
			cognitiveMean: (group.cognitiveDelta as { mean: number | null }).mean,
		})),
	);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval post-analysis
```

Expected: PASS, 8 tests. Note the first test downloads the pinned ref on first run (~20MB) and caches it under `agent-eval/.eval-cache/refs/`.

- [ ] **Step 5: Commit**

```bash
cd /home/steve/Development/mcp && pnpm format
git add "agent-eval/evals/701-agentic-ref-reuse-component-mcp"
git commit -m "feat(agent-eval): add the 701 post-analysis hook

Composes every metric module into one record and writes analysis.json next
to result.json. densityPerSloc is null when no lines changed, and transcript
metrics are null when the transcript is unreadable, so a partial run still
yields the metrics it can support."
```

---

### Task 12: Rewrite the analyzer as a generic gateway

**Files:**

- Rewrite: `agent-eval/scripts/analyze-results.mjs`

**Interfaces:**

- Consumes: `analyzeRun`, `summarize`, `renderTables` from `evals/<name>/post-analysis.ts` (Task 11).
- Produces: the `pnpm results:analyze` command, used by Task 13's CI step.

**What changes:** the script currently hardcodes Mealdrop's Button component, the external-repo pin format, ref fetching, and a Button-specific aggregation — all of which moved into the eval in Tasks 10 and 11. What remains is discovery and dispatch. It drops from 387 lines to roughly 150.

- [ ] **Step 1: Replace the script**

Overwrite `agent-eval/scripts/analyze-results.mjs` with:

```js
#!/usr/bin/env node
// Offline metrics pass over stored eval runs.
//
// This script is deliberately eval-agnostic. It discovers run directories and
// hands each one to that eval's own hook at evals/<name>/post-analysis.ts;
// which metrics matter, and what they are measured against, is the eval's
// business. Evals without a hook are skipped.
//
// Every metric is a pure function of stored artifacts, so this can be re-run
// over historical results as often as a metric definition changes, without
// spending anything on model calls.
//
// Usage: pnpm results:analyze [--experiment=<name>] [--since=<ISO date>] [--latest]
//
//   --experiment=<name>  only runs under results/<name>/
//   --since=<ISO date>   only runs whose result directory is stamped on or after
//   --latest             only the newest result directory per experiment
//
// The filters exist because results/ accumulates: every invocation adds a new
// timestamped directory, and older ones may come from a different fixture pin.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = join(ROOT, 'results');
const EVALS_DIR = join(ROOT, 'evals');

// --- options ---
function parseArgs(argv) {
	const options = { experiment: null, since: null, latest: false };
	for (const arg of argv) {
		const [flag, value] = arg.split('=');
		if (flag === '--latest') options.latest = true;
		else if (flag === '--experiment' && value) options.experiment = value;
		else if (flag === '--since' && value) options.since = value;
		else
			throw new Error(
				`Unknown argument "${arg}". See the usage comment in scripts/analyze-results.mjs.`,
			);
	}
	return options;
}

// --- discovery ---
// Layout: results/<experiment>/<model>/<timestamp>/<eval>/run-N/project
function findRuns(dir) {
	if (!existsSync(dir)) return [];
	const runs = [];
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const path = join(current, entry.name);
			if (!/^run-\d+$/.test(entry.name) || !existsSync(join(path, 'project'))) {
				walk(path);
				continue;
			}
			const parts = path.slice(RESULTS_DIR.length + 1).split('/');
			runs.push({
				runDir: path,
				projectDir: join(path, 'project'),
				experiment: parts[0],
				model: parts.slice(1, -3).join('/'),
				timestamp: parts.at(-3),
				evalName: parts.at(-2),
				run: Number.parseInt(entry.name.slice('run-'.length), 10),
			});
		}
	};
	walk(dir);
	return runs;
}

// Result directories are ISO timestamps with the time's ':' replaced by '-',
// e.g. 2026-07-27T10-43-55.864Z.
function parseTimestamp(timestamp) {
	return new Date(timestamp.replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3'));
}

function selectRuns(runs, options) {
	let selected = runs;
	if (options.experiment) {
		selected = selected.filter((run) => run.experiment === options.experiment);
	}
	if (options.since) {
		const since = new Date(options.since);
		if (Number.isNaN(since.getTime())) {
			throw new Error(`--since must be a parseable date; received "${options.since}"`);
		}
		selected = selected.filter((run) => parseTimestamp(run.timestamp) >= since);
	}
	if (options.latest) {
		const newest = new Map();
		for (const run of selected) {
			const current = newest.get(run.experiment);
			if (current === undefined || run.timestamp > current)
				newest.set(run.experiment, run.timestamp);
		}
		selected = selected.filter((run) => run.timestamp === newest.get(run.experiment));
	}
	return selected;
}

// --- hook loading ---
// Node 24 strips types on import, so a .ts hook loads from this .mjs directly.
const hookCache = new Map();

async function loadHook(evalName) {
	if (hookCache.has(evalName)) return hookCache.get(evalName);

	const path = join(EVALS_DIR, evalName, 'post-analysis.ts');
	let hook = null;
	if (existsSync(path)) {
		hook = await import(pathToFileURL(path).href);
		if (typeof hook.analyzeRun !== 'function') {
			throw new Error(`${evalName}/post-analysis.ts must export an analyzeRun function`);
		}
	}

	hookCache.set(evalName, hook);
	return hook;
}

function readJson(path) {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const runs = selectRuns(findRuns(RESULTS_DIR), options);

	const rows = [];
	const withoutHook = new Set();
	const failed = [];

	for (const run of runs) {
		const hook = await loadHook(run.evalName);
		if (hook === null) {
			withoutHook.add(run.evalName);
			continue;
		}

		try {
			const row = await hook.analyzeRun({
				runDir: run.runDir,
				projectDir: run.projectDir,
				fixtureDir: join(EVALS_DIR, run.evalName),
				experiment: run.experiment,
				model: run.model,
				timestamp: run.timestamp,
				evalName: run.evalName,
				run: run.run,
				result: readJson(join(run.runDir, 'result.json')),
				readTranscript: () => {
					const transcript = readJson(join(run.runDir, 'transcript.json'));
					if (transcript === null) throw new Error('transcript.json missing or unreadable');
					return transcript;
				},
			});
			if (row) rows.push({ ...row, __eval: run.evalName });
		} catch (error) {
			// One broken run must not cost us the others.
			failed.push(`${run.evalName} run-${run.run}: ${error.message}`);
		}
	}

	if (withoutHook.size > 0) {
		console.log(`Skipped evals with no post-analysis.ts: ${[...withoutHook].join(', ')}`);
	}
	for (const message of failed) console.error(`Analysis failed for ${message}`);

	if (rows.length === 0) {
		console.log('No analysable runs found under results/.');
		return;
	}

	rows.sort(
		(a, b) =>
			String(a.experiment).localeCompare(String(b.experiment)) ||
			String(a.timestamp).localeCompare(String(b.timestamp)) ||
			a.run - b.run,
	);

	// Aggregation and rendering belong to the eval; fall back to a generic table.
	const byEval = new Map();
	for (const row of rows) {
		const list = byEval.get(row.__eval) ?? [];
		list.push(row);
		byEval.set(row.__eval, list);
	}

	// `__eval` is internal routing state, stripped before anything sees a record.
	const strip = (row) =>
		Object.fromEntries(Object.entries(row).filter(([key]) => key !== '__eval'));

	const allSummaries = [];
	for (const [evalName, evalRows] of byEval) {
		const hook = await loadHook(evalName);
		const bare = evalRows.map(strip);
		const summary = typeof hook.summarize === 'function' ? hook.summarize(bare) : [];
		allSummaries.push(...summary);

		if (typeof hook.renderTables === 'function') hook.renderTables(bare, summary);
		else console.table(bare.map(({ experiment, run, status }) => ({ experiment, run, status })));
	}

	writeFileSync(
		join(RESULTS_DIR, 'agentic-ref-analysis.json'),
		JSON.stringify({ runs: rows.map(strip), summary: allSummaries }, null, 2) + '\n',
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
```

- [ ] **Step 2: Run it against the stored run**

```bash
cd /home/steve/Development/mcp/agent-eval && pnpm results:analyze --latest
```

Expected: two tables printed, the first showing `run 1`, `status failed`, `seconds 403.365`, `turns 12`, `costUsd 1.89273325`, `docs 1`, `explore 14`, `slocAdded 9`.

- [ ] **Step 3: Verify the written artifact**

```bash
cd /home/steve/Development/mcp/agent-eval && node -e "
const { globSync } = require('node:fs');
const [p] = globSync('results/**/run-1/analysis.json');
const a = require('./' + p);
console.log('speed      ', JSON.stringify(a.speed));
console.log('buckets    ', JSON.stringify(a.toolUse.buckets));
console.log('churn      ', JSON.stringify(a.churn.perFile));
console.log('sloc       ', JSON.stringify(a.diff.sloc));
console.log('complexity ', JSON.stringify(a.complexity.cognitive));
"
```

Expected:

```
speed       {"durationSeconds":403.365,"turns":12}
buckets     {"docs":1,"exploration":13,"edit":8,"verification":6,"other":1}
churn       {"src/components/Footer/Footer.tsx":3}
sloc        {"added":9,"removed":1,"net":8}
complexity  {"before":<n>,"after":<n>,"delta":<n>}
```

- [ ] **Step 4: Commit**

```bash
cd /home/steve/Development/mcp && pnpm format
git add agent-eval/scripts/analyze-results.mjs
git commit -m "refactor(agent-eval): make analyze-results a generic gateway

Discovery and dispatch only; each eval owns its metrics via a
post-analysis.ts hook. Removes the hardcoded Button-import metric, the
external-repo pin handling and the duplicated SAFE_GITHUB_PATH check, all of
which now live in the eval that needs them. One failing run no longer aborts
the pass."
```

---

### Task 13: Keep analysis code out of the sandbox, and run it on CI

**Files:**

- Modify: `agent-eval/patches/@vercel__agent-eval@1.2.0.patch`
- Modify: `.github/workflows/agent-eval.yml`

**Interfaces:**

- Consumes: `pnpm results:analyze` from Task 12.

**Why the patch is necessary.** Fixture directories are uploaded into the agent's workspace before it runs. `EXCLUDED_FILES` does not govern that — its own source comment says _"This is for local fixture introspection, NOT for sandbox uploads."_ Uploads are filtered by `IGNORED_PATTERNS` in `dist/lib/sandbox.js` via `collectLocalFiles`, and only `TEST_FILE_PATTERNS` (`EVAL.ts`, `EVAL.tsx`, `PROMPT.md`) are held back until after the agent finishes. Both `claude-code/agent.js` and `codex/agent.js` delegate to `plugin/orchestrator.js`, so this applies to every agent we run.

Without the patch, the agent under evaluation would find `post-analysis.ts` and `__analysis__/` in `/workspace` — including the file defining the tool-use buckets it is scored on — and `__analysis__/*.test.ts` would be collected by the sandbox's validation vitest run.

**Why not `helpers`.** `shouldExclude(name, relativePath)` matches on **basename** as well as full path, and Mealdrop has a real `src/helpers/` directory containing `getCurrency.ts` and `index.ts`. Adding `helpers` to the ignore list would delete application source. `__analysis__` follows the existing `__metrics__` / `__agent_eval__` convention and cannot collide.

- [ ] **Step 1: Find the current patch target**

```bash
cd /home/steve/Development/mcp/agent-eval && grep -n "IGNORED_PATTERNS = \[" -A 12 node_modules/@vercel/agent-eval/dist/lib/sandbox.js
```

Expected: the array at roughly line 19 containing `.git`, `.next`, `node_modules`, `.DS_Store`, `*.log`, `build`, `dist`, `pnpm-lock.yaml`, `package-lock.json`.

- [ ] **Step 2: Edit the vendored file and regenerate the patch**

pnpm patches are regenerated from an editable copy, not hand-written:

```bash
cd /home/steve/Development/mcp/agent-eval && pnpm patch @vercel/agent-eval@1.2.0
```

This prints a temporary directory. In that directory, edit `dist/lib/sandbox.js` so `IGNORED_PATTERNS` reads:

```js
export const IGNORED_PATTERNS = [
	'.git',
	'.next',
	'node_modules',
	'.DS_Store',
	'*.log',
	'build',
	'dist',
	'pnpm-lock.yaml',
	'package-lock.json',
	// Offline post-run analysis lives beside the fixture it belongs to, but must
	// never reach the sandbox: the agent under evaluation would otherwise be able
	// to read the definitions of the metrics scoring it, and the colocated vitest
	// files would be collected by the post-run validation run.
	'post-analysis.ts',
	'__analysis__',
];
```

Then commit the patch, substituting the printed path:

```bash
cd /home/steve/Development/mcp/agent-eval && pnpm patch-commit '<printed-temp-dir>'
```

- [ ] **Step 3: Verify the patch applies and takes effect**

```bash
cd /home/steve/Development/mcp/agent-eval && pnpm install && grep -n "post-analysis\|__analysis__" node_modules/@vercel/agent-eval/dist/lib/sandbox.js
```

Expected: both entries present in the installed copy. If absent, `patch-commit` did not pick up the edit.

Confirm the fixture would now upload cleanly:

```bash
cd /home/steve/Development/mcp/agent-eval && node -e "
import('@vercel/agent-eval/dist/lib/sandbox.js').then(async (m) => {
  const files = await m.collectLocalFiles('evals/701-agentic-ref-reuse-component-mcp');
  console.log(files.map((f) => f.path ?? f).sort());
});
"
```

Expected: `package.json` only. `post-analysis.ts` and everything under `__analysis__/` must be absent. `EVAL.ts` and `PROMPT.md` may appear here — they are filtered later by `splitTestFiles`, not by this call.

- [ ] **Step 4: Add the CI step**

In `.github/workflows/agent-eval.yml`, insert a step between "Check eval results" and "Archive eval results":

```yaml
- name: Compute offline metrics
  if: ${{ always() && steps.check_results.outputs.has_result_files == 'true' }}
  # Writes analysis.json next to each run's result.json so the metrics ride
  # along in the uploaded artifact. Needs network to fetch the pinned
  # external ref, which the script already does today via codeload.
  # Non-blocking: a metrics failure must not fail an otherwise good run.
  continue-on-error: true
  working-directory: agent-eval
  run: pnpm results:analyze
```

- [ ] **Step 5: Verify the workflow is still valid YAML and the step is ordered correctly**

```bash
node -e "
const text = require('node:fs').readFileSync('.github/workflows/agent-eval.yml', 'utf8');
const order = ['Check eval results', 'Compute offline metrics', 'Archive eval results']
  .map((name) => [name, text.indexOf('name: ' + name)]);
console.log(order);
if (order.some(([, index]) => index === -1)) throw new Error('a step is missing');
if (order[0][1] > order[1][1] || order[1][1] > order[2][1]) throw new Error('steps out of order');
console.log('order OK');
"
```

Expected: `order OK`.

- [ ] **Step 6: Commit**

```bash
cd /home/steve/Development/mcp
git add agent-eval/patches agent-eval/package.json agent-eval/pnpm-lock.yaml pnpm-lock.yaml .github/workflows/agent-eval.yml
git commit -m "chore(agent-eval): hide analysis code from the sandbox and run metrics on CI

Fixture directories are uploaded into the agent's workspace before it runs,
and IGNORED_PATTERNS is what filters them, not EXCLUDED_FILES. Without this
the agent could read the definitions of the metrics scoring it. The entries
are post-analysis.ts and __analysis__ rather than a generic name: the ignore
check matches on basename and Mealdrop has a real src/helpers directory.

Also runs results:analyze before the artifact is tarred, so analysis.json
actually leaves CI. Non-blocking, since a metrics failure should not fail an
otherwise good eval run."
```

---

### Task 14: Full verification run

**Files:** none created; this task verifies the whole system.

- [ ] **Step 1: Run the complete test suite**

```bash
cd /home/steve/Development/mcp && npx vitest run --project agent-eval
```

Expected: PASS. Roughly 85 new tests across `shell-segments`, `tool-taxonomy`, `churn`, `run-signals`, `sloc`, `tree-diff`, `cyclomatic`, `cognitive`, `baseline` and `post-analysis`, plus the pre-existing `lib/templates.test.ts` and `lib/test-utils.test.ts`.

- [ ] **Step 2: Typecheck**

```bash
cd /home/steve/Development/mcp/agent-eval && pnpm typecheck
```

Expected: no errors. If it reports the new files as not found, `tsconfig.json`'s `include` from Task 1 was not applied.

- [ ] **Step 3: Lint and format**

```bash
cd /home/steve/Development/mcp && pnpm lint && pnpm format:check
```

Expected: clean. Run `pnpm format` if the check fails.

- [ ] **Step 4: Full offline pass over stored results**

```bash
cd /home/steve/Development/mcp/agent-eval && pnpm results:analyze
```

Expected: both tables render, and no `Analysis failed for …` lines appear.

- [ ] **Step 5: Confirm idempotency**

Re-running must produce identical output — the metrics are pure functions of stored artifacts, so a difference means hidden state.

```bash
cd /home/steve/Development/mcp/agent-eval && \
cp results/agentic-ref-analysis.json /tmp/pass-1.json && \
pnpm results:analyze >/dev/null && \
diff /tmp/pass-1.json results/agentic-ref-analysis.json && echo "IDEMPOTENT"
```

Expected: `IDEMPOTENT`.

- [ ] **Step 6: Live eval run**

This is the only step that spends money — roughly $2 and 7 minutes.

```bash
cd /home/steve/Development/mcp/agent-eval && \
EVAL_AGENTIC_REFERENCE=1 AGENTIC_REF_RUNS=1 pnpm eval agentic-ref-reuse-component-cc-mcp-opus-high
```

Expected: the run completes and a new timestamped directory appears under `results/agentic-ref-reuse-component-cc-mcp-opus-high/`.

- [ ] **Step 7: Confirm the sandbox stayed clean**

The critical check: analysis code must not have reached the agent's workspace.

```bash
cd /home/steve/Development/mcp/agent-eval && \
find results -path "*/run-*/project/post-analysis.ts" -o -path "*/run-*/project/__analysis__*" | head
```

Expected: **no output**. Any result here means the patch did not take effect and the agent could see the metric definitions — stop and fix Task 13 before trusting any measurement.

- [ ] **Step 8: Analyse the fresh run**

```bash
cd /home/steve/Development/mcp/agent-eval && pnpm results:analyze --latest
```

Expected: a table row for the new run with non-null `seconds`, `turns`, `costUsd`, `docs`, `explore`, `slocAdded` and `cognitive`.

Sanity-check the values against the recorded run rather than assuming they match — a different run legitimately produces different numbers, but nulls or absurd values indicate a bug:

- `docs` should be at least 1 if the eval passed its documentation assertion.
- `slocAdded` should be single or low double digits for a one-button change.
- `cognitive` delta should be small; a large value means the changed-file set is wrong.

- [ ] **Step 9: Commit any baseline the fresh run generated**

```bash
cd /home/steve/Development/mcp && git status --short "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/baselines"
```

If a new baseline file appeared (the pin moved), commit it:

```bash
git add "agent-eval/evals/701-agentic-ref-reuse-component-mcp/__analysis__/baselines"
git commit -m "chore(agent-eval): add complexity baseline for the current pin"
```

---

## Verification checklist

Every metric from the specification, and where it is proved:

| Metric                                    | Task       | Proof                                                                           |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| workflow duration                         | 5          | golden test asserts 403.365                                                     |
| number of turns                           | 5          | golden test asserts 12                                                          |
| input/output/cache tokens                 | 5          | golden test asserts all four counts                                             |
| cache-hit percentage                      | 5          | golden test asserts 0.8330                                                      |
| tool-call counts                          | 5          | golden test asserts 25                                                          |
| derived cost                              | 5          | golden test asserts $1.89273325                                                 |
| SLoC diff                                 | 7          | golden check asserts +9 / −1 over 1 file                                        |
| per-file iteration count                  | 4          | golden test asserts Footer.tsx = 3                                              |
| cyclomatic complexity diff                | 8, 11      | four ported tests plus the composed record                                      |
| cognitive complexity diff                 | 9, 11      | white-paper sumOfPrimes = 7 plus the composed record                            |
| doc vs exploration vs edit classification | 3          | golden test asserts docs 1 / exploration 14 / edit 8 / verification 7 / other 0 |
| metrics written to the run artifact       | 11, 12, 13 | `analysis.json` written per run; CI step added before the tar                   |

## Deliberately not built

- **axe-core accessibility violations.** A separate specification. It needs to build and serve the application and drive it with Playwright through per-eval user journeys, with axe-core injected as a standalone script rather than through a runtime-specific wrapper. It is blocked in practice by the binary-corruption bug: the collected tree's images and fonts are destroyed by a lossy UTF-8 round trip on the copy-out path, so the application cannot be rendered faithfully.
- **Fan-in weighted complexity.** Investigated across shipped tooling and the academic literature; no tool implements it, and the field explicitly rejected combining complexity with coupling.
- **The exploration-to-documentation ratio as a stored field.** Raw bucket counts are stored instead; the ratio is a cross-arm comparison computed later over all runs.
- **LLM-judge columns.** Out of scope for this pass.
