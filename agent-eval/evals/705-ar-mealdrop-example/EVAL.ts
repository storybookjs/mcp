// Working example eval for the agentic-reference project (SB-1724): runs
// against the REAL Mealdrop benchmark app (yannbf/mealdrop, pinned to
// agentic-reference/original — see package.json's evals.benchmarkApp
// marker and lib/agentic-reference/benchmark-app.ts) instead of the generic
// vite-app placeholder the 700-704 fixtures still use. Proves the
// benchmark-app-by-git-ref pipeline end-to-end; the real per-workflow
// prompts/rubrics land under SB-1689.
import { readFileSync } from 'node:fs';

import { environment } from '@vercel/agent-eval/eval';
import { expect, test } from 'vitest';
import { getTranscript } from '#test-utils';

const RESTAURANT_CARD_PATH = 'src/components/RestaurantCard/RestaurantCard.tsx';

// Number of times the literal substring "Badge" appears in the pristine
// RestaurantCard.tsx at the pinned ref (yannbf/mealdrop@agentic-reference/original,
// commit 7fcc93f): the `import { Badge } from '../Badge'` line, the
// `const StyledBadge = styled(Badge)` wrapper, and the one existing
// `<StyledBadge .../>` usage for category tags. A correct implementation
// that reuses Badge for the new "Popular" indicator adds at least one more
// reference on top of this baseline.
const PRISTINE_RESTAURANT_CARD_BADGE_REFERENCES = 5;

test('agent produced a transcript', () => {
	const transcript = getTranscript();
	expect(transcript.events.length, 'Expected the transcript to contain events').toBeGreaterThan(0);
});

// DS-reuse signal (the behavior this whole project measures): does the
// agent extend the card with the project's own Badge component, or
// hand-roll new markup (a bare <span>/<div>) for the "Popular" label
// instead? Deliberately a SOFT signal, not a gate — a control case with no
// docs/MCP may reasonably not discover Badge at all, and this test is
// allowed to fail there. What matters is the PASS/FAIL delta across the 4
// context cases (control-empty / control-official-docs /
// control-community-mcp / treatment-storybook-mcp), not any single case's
// result. Deterministic: reads the final sandbox file directly (EVAL.ts
// runs via `npx vitest` INSIDE the sandbox, after the neutral-workspace
// relocation, so relative fs reads see the agent's actual end state — see
// runValidation / prepareNeutralWorkspace in
// @vercel/agent-eval/dist/lib/agents/shared.js).
//
// Limitation: only catches Badge reuse inside RestaurantCard.tsx itself: an
// agent that factors the indicator into a new component which itself wraps
// Badge, without RestaurantCard.tsx's own Badge-reference count growing,
// would read as a miss here. Acceptable for a soft, comparative signal.
test('reuses the existing Badge design-system component', () => {
	const source = readFileSync(RESTAURANT_CARD_PATH, 'utf8');
	const badgeReferenceCount = (source.match(/Badge/g) ?? []).length;

	expect(
		badgeReferenceCount,
		`Expected ${RESTAURANT_CARD_PATH} to reference Badge more than the pristine baseline ` +
			`(${PRISTINE_RESTAURANT_CARD_BADGE_REFERENCES} references) — i.e. the "Popular" indicator ` +
			`reuses the existing Badge component rather than hand-rolled markup. Found ${badgeReferenceCount} references.`,
	).toBeGreaterThan(PRISTINE_RESTAURANT_CARD_BADGE_REFERENCES);
});

test('renders a Popular indicator on highly-rated restaurant cards', async () => {
	await expect(environment).toScoreAtLeast(
		'The agent implemented the task described in PROMPT.md: restaurant cards in ' +
			`${RESTAURANT_CARD_PATH} now show a visible "Popular" indicator (a label, tag, or badge ` +
			'reading "Popular" or similar) when the restaurant\'s rating is 4.5 or higher. Restaurants ' +
			'with no rating, or a rating below 4.5, do not show the indicator. The indicator is wired to ' +
			'the actual rating prop/data — not hardcoded to always or never render.',
		0.5,
	);
});
