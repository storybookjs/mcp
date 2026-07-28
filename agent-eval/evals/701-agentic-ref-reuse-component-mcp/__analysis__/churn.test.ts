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

	it('does not count stderr suppression as a write', () => {
		const churn = computeChurn([shell('grep -rn "x" src 2>/dev/null')]);
		expect(churn.perFile).toEqual({});
	});

	it('counts a removal as a write to that path', () => {
		const churn = computeChurn([shell('rm -f src/tmp.test.ts')]);
		expect(churn.perFile).toEqual({ 'src/tmp.test.ts': 1 });
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

	it('ignores non tool_call events', () => {
		expect(computeChurn([{ type: 'message', role: 'user', content: 'hi' }]).perFile).toEqual({});
	});

	it('reproduces the golden run exactly', () => {
		const churn = computeChurn(goldenTranscript.events);
		expect(churn.perFile['src/components/Footer/Footer.tsx']).toBe(3);
	});
});
