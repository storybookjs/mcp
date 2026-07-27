// Agentic-reference reuse-component eval: the agent makes a small footer change
// that should reuse the app's own Button component, with the design system's
// published Storybook MCP available.
// Asserts the outcome, one MCP-usage signal (published `@storybook/mcp`
// builds expose only the documentation workflow, hence
// expectDocumentationToolingCalled), and that the app's own test suite
// still passes.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { expect, test } from 'vitest';
import {
	expectDocumentationToolingCalled,
	getStorybookWorkflowCalls,
	getTranscript,
} from '#test-utils';

const FOOTER_PATH = 'src/components/Footer/Footer.tsx';

// The design-system MCP documentation workflows (mirrors the private list in
// #test-utils). Kept local so this fixture can derive a doc-tool count without
// widening the test-utils surface.
const DOCUMENTATION_WORKFLOW_NAMES = [
	'get-documentation',
	'get-documentation-for-story',
	'list-all-documentation',
];

test('agent produced a transcript', () => {
	const transcript = getTranscript();
	expect(transcript.events.length, 'Expected the transcript to contain events').toBeGreaterThan(0);
});

// Research signal, RECORDED not asserted: which design-system MCP tools the
// agent called and how often. A run that consulted no docs tooling is a valid
// data point for analysis, so this only writes the metric — the pass/fail gate
// lives in the separate "consulted the documentation tools" test below.
test('records the MCP tool-usage signal', () => {
	const calls = getStorybookWorkflowCalls();
	const byTool: Record<string, number> = {};
	for (const call of calls) {
		byTool[call.name] = (byTool[call.name] ?? 0) + 1;
	}

	mkdirSync('__metrics__', { recursive: true });
	writeFileSync(
		'__metrics__/mcp-usage.json',
		JSON.stringify(
			{
				totalWorkflowCalls: calls.length,
				byTool,
				documentationToolCalls: DOCUMENTATION_WORKFLOW_NAMES.reduce(
					(sum, name) => sum + (byTool[name] ?? 0),
					0,
				),
			},
			null,
			2,
		) + '\n',
	);

	// Non-gating: this test exists to persist the metric, not to judge the run.
	expect(calls.length, 'workflow-call parsing should not throw').toBeGreaterThanOrEqual(0);
});

test("Footer.tsx uses the app's own Button component", () => {
	expect(existsSync(FOOTER_PATH), `Expected ${FOOTER_PATH} to exist`).toBe(true);

	const source = readFileSync(FOOTER_PATH, 'utf8');
	// Accept any specifier that resolves to the app's Button component:
	// '../Button', '../Button/Button', '../Button/index',
	// 'src/components/Button', '@/components/Button', ...
	expect(
		source,
		`Expected ${FOOTER_PATH} to import Button from the app's own Button component`,
	).toMatch(/from\s+['"][^'"]*\/Button(?:\/(?:Button|index))?(?:\.tsx?)?['"]/);
	expect(source, `Expected ${FOOTER_PATH} to render the Button component`).toMatch(/<Button[\s/>]/);
});

test('agent consulted the design system Storybook MCP documentation tools', () => {
	expectDocumentationToolingCalled();
});

// Side-effectful, so deliberately LAST: tests in this file run sequentially in
// declaration order and share the workspace — everything above must assert on
// the untouched post-agent state.
test('app test suite still passes after the agent changes', () => {
	// Preserved by setupExternalRepo; the harness clobbers the original
	// vitest.config.ts at validation time.
	const appConfig = 'vitest.config.app.ts';
	expect(existsSync(appConfig), `Expected ${appConfig} (preserved by setup)`).toBe(true);

	let exitCode = 0;
	let output = '';
	try {
		// --project node: the app's `storybook` vitest project is browser-mode
		// and needs a Playwright chromium the sandbox doesn't have; gate on
		// the unit project only.
		output = execSync(`npx vitest run --config ${appConfig} --project node`, {
			encoding: 'utf8',
			// Don't leak the outer vitest run's env into the child suite.
			env: { ...process.env, VITEST: undefined, NO_COLOR: '1' },
			timeout: 300_000,
		});
	} catch (error) {
		const failure = error as { status?: number; stdout?: string; stderr?: string };
		exitCode = failure.status ?? 1;
		output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
	}

	// Write the metric before asserting, so the artifact ships even on failure.
	mkdirSync('__metrics__', { recursive: true });
	writeFileSync(
		'__metrics__/app-tests.json',
		JSON.stringify(
			{
				passed: exitCode === 0,
				exitCode,
				summary: output.match(/Tests\s+.*$/m)?.[0]?.trim() ?? 'no summary line found',
			},
			null,
			2,
		) + '\n',
	);

	expect(exitCode, `App test suite failed:\n${output.slice(-2000)}`).toBe(0);
});
