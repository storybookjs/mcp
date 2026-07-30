import { expect, test } from 'vitest';
import { getTranscript } from '#test-utils';

test('agent produced a transcript', () => {
	const transcript = getTranscript();
	expect(transcript.events.length, 'Expected the transcript to contain events').toBeGreaterThan(0);
});
