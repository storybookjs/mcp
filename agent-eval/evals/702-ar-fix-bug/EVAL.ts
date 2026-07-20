// Placeholder eval for the agentic-reference fix-bug workflow (SB-1724).
// Assertions are deliberately minimal and case-agnostic: they must pass
// uniformly across all 4 context cases (see
// agent-eval/lib/agentic-reference/cases.ts), including control-empty, which
// has no docs or MCP to lean on. Replace with real fix-bug assertions once
// SB-1689 authors the workflow prompt and SB-1680/SB-1681 ship the
// Mealdrop-on-Base-UI benchmark app.
import { environment } from '@vercel/agent-eval/eval';
import { expect, test } from 'vitest';
import { getTranscript } from '#test-utils';

// TODO(SB-1686): quantitative metrics (SLoC, complexity, DS coverage, axe-core)
// TODO(SB-1683): run traceability

test('agent produced a transcript', () => {
	const transcript = getTranscript();
	expect(transcript.events.length, 'Expected the transcript to contain events').toBeGreaterThan(0);
});

test('attempts the requested fix-bug task', async () => {
	// Low threshold: a smoke check that the agent made a plausible attempt,
	// not a quality gate. Real fix-bug rubrics (alert() actually removed,
	// status message times out correctly, etc.) land with the authored
	// prompt.
	await expect(environment).toScoreAtLeast(
		'The agent attempted the bug fix described in PROMPT.md: it modified source files in this project in a way that plausibly addresses the described bug, rather than leaving the project unchanged or refusing the request.',
		0.3,
	);
});
