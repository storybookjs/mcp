// Minimal educational agentic-reference eval — see
// agent-eval/AGENTIC-REFERENCE-EVAL.md for what this demonstrates and how
// to run it. Deliberately ONE deterministic assertion (no LLM judge): does
// the app's own Footer.tsx end up importing/using the app's own Button
// component? That's the whole check — this eval exists to show the
// materialize-app -> prompt -> agent -> assert shape, not to be a rigorous
// workflow rubric.
import { existsSync, readFileSync } from 'node:fs';

import { expect, test } from 'vitest';
import { getTranscript } from '#test-utils';

const FOOTER_PATH = 'src/components/Footer/Footer.tsx';

test('agent produced a transcript', () => {
	const transcript = getTranscript();
	expect(transcript.events.length, 'Expected the transcript to contain events').toBeGreaterThan(0);
});

test('Footer.tsx uses the app-s own Button component', () => {
	expect(existsSync(FOOTER_PATH), `Expected ${FOOTER_PATH} to exist`).toBe(true);

	const source = readFileSync(FOOTER_PATH, 'utf8');
	expect(
		source,
		`Expected ${FOOTER_PATH} to import Button from the app's own Button component`,
	).toMatch(/from\s+['"].*components\/Button['"]/);
});
