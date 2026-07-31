// Sanity gate, not measurement: a run whose agent died or produced no
// transcript fails here instead of reporting success. Everything this eval
// actually measures is computed offline; see
// lib/agentic-reference/post-analysis.ts.
import { expect, test } from 'vitest';
import { getTranscript } from '#test-utils';

test('agent produced a transcript', () => {
	const transcript = getTranscript();
	expect(transcript.events.length, 'Expected the transcript to contain events').toBeGreaterThan(0);
});
