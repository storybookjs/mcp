// Turning a run into one Messages API request.
//
// The ordering here is the whole cost story. Prompt caching is a prefix match
// over tools -> system -> messages, so the ~95k-token guideline corpus goes in
// `system` with the cache breakpoint on it, and everything that varies per run
// goes in `messages`, after the breakpoint. A single volatile byte placed before
// it — a timestamp, the fixture ref, a node path — would invalidate the corpus on
// every request and turn a ~$0.10 read back into a ~$1 write.
import { readFileSync } from 'node:fs';

import { JUDGE_OUTPUT_SCHEMA } from './types.ts';

import type { DsDoc } from './ds-docs.ts';
import type { TreePatch } from './tree-patch.ts';
import type { NodeRecord } from '../ds-coverage/types.ts';

export const JUDGE_MODEL = 'claude-opus-4-8';

/**
 * Version of the judge itself, independent of the deterministic metrics that
 * feed it. Bump when the prompt, the DS guidelines content baked into a run,
 * the model, or any judging internals change — anything that would make a
 * stored score not comparable with a freshly judged one.
 */
export const DS_MISUSE_JUDGE_VERSION = 1;

/**
 * 1h is the longest TTL the API offers (the only values are `5m` and `1h`), and
 * it is enough for a sweep of any length because a cache read refreshes the
 * lifetime for free — what must stay under the TTL is the gap between two
 * consecutive judge calls, not the duration of the whole pass. It is chosen over
 * the cheaper `5m` default for headroom: the lifetime runs from the *start* of
 * the request that reads it, so a multi-minute generation counts against it.
 */
const CACHE_CONTROL = { type: 'ephemeral', ttl: '1h' } as const;

/** Room for a reason per score across a large change set. */
const MAX_TOKENS = 32_000;

const PROMPT_PATH = new URL('./prompt.md', import.meta.url);

export interface JudgeRequestInput {
	docs: DsDoc[];
	baselineNodes: NodeRecord[];
	treatmentNodes: NodeRecord[];
	patch: TreePatch;
	fixtureRef: string;
}

function docsBlock(docs: DsDoc[]): string {
	return docs.map((doc) => `<document path="${doc.path}">\n${doc.text}\n</document>`).join('\n\n');
}

/** One node per line: far cheaper than pretty-printed JSON, and just as readable. */
function nodeLines(nodes: NodeRecord[]): string {
	if (nodes.length === 0) return '(none)';
	return nodes
		.map(
			(node) =>
				`${node.path}\t${node.file}:${node.line}\t${node.category}\t${node.module}#${node.name}\tprops=[${node.props.join(',')}]`,
		)
		.join('\n');
}

function userText(input: JudgeRequestInput): string {
	const truncation = input.patch.truncated
		? `\n\nNOTE: the diff below is TRUNCATED. ${input.patch.droppedFiles} changed file(s) were dropped to fit. Judge only nodes you can see in it; omit the rest.`
		: '';

	return [
		`FIXTURE: ${input.fixtureRef}`,
		truncation.trim(),
		'',
		'BASELINE NODES (the pinned tree, before the agent worked)',
		'Format: path<TAB>file:line<TAB>category<TAB>module#name<TAB>props',
		nodeLines(input.baselineNodes),
		'',
		'TREATMENT NODES (after the agent worked, restricted to files it touched)',
		nodeLines(input.treatmentNodes),
		'',
		`DIFF (${input.patch.files.length} file(s))`,
		input.patch.text || '(no source changes)',
	]
		.filter((section) => section !== '')
		.join('\n');
}

/** The full `messages.create` parameter object, ready to stream. */
export function buildJudgeRequest(input: JudgeRequestInput) {
	return {
		model: JUDGE_MODEL,
		max_tokens: MAX_TOKENS,
		thinking: { type: 'adaptive' as const },
		output_config: {
			effort: 'high' as const,
			format: { type: 'json_schema' as const, schema: JUDGE_OUTPUT_SCHEMA },
		},
		// Stable, and in this order: the breakpoint on the last block caches both.
		system: [
			{ type: 'text' as const, text: readFileSync(PROMPT_PATH, 'utf8') },
			{ type: 'text' as const, text: docsBlock(input.docs), cache_control: CACHE_CONTROL },
		],
		messages: [
			{
				role: 'user' as const,
				content: [{ type: 'text' as const, text: userText(input) }],
			},
		],
	};
}
