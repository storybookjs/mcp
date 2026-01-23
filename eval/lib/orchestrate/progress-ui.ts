import type { RunProgress } from './types.ts';

const STATUS_ICON: Record<RunProgress['status'], string> = {
	pending: '○',
	running: '⟳',
	success: '✓',
	failed: '✕',
};

const MAX_ERROR_LENGTH = 20;

export function renderProgressUI(params: {
	orchestrationName: string;
	evalName: string;
	uploadId: string | false;
	runId: string;
	runs: RunProgress[];
}): void {
	const { orchestrationName, evalName, uploadId, runId, runs } = params;
	const now = Date.now();

	const lines: string[] = [];
	lines.push(`Orchestration: ${orchestrationName}`);
	lines.push(`Eval: ${evalName}`);
	lines.push(`Upload ID: ${uploadId === false ? 'skip' : uploadId}`);
	lines.push(`Run ID: ${runId}`);
	lines.push('');

	const grouped = runs.reduce<Record<string, RunProgress[]>>((acc, run) => {
		if (!acc[run.request.variantId]) {
			acc[run.request.variantId] = [];
		}
		acc[run.request.variantId]?.push(run);
		return acc;
	}, {});

	for (const [variantId, variantRuns] of Object.entries(grouped)) {
		const label = variantRuns[0]?.request.variantLabel ?? variantId;
		lines.push(`Variant: ${label}`);
		for (const run of variantRuns) {
			lines.push(`  ${formatRunLine(run, now)}`);
		}
		lines.push('');
	}

	const total = runs.length;
	const complete = runs.filter((r) => r.status === 'success').length;
	const running = runs.filter((r) => r.status === 'running').length;
	const failed = runs.filter((r) => r.status === 'failed').length;
	const pending = total - complete - running - failed;

	lines.push(
		`Total: ${complete}/${total} complete, ${running} running, ${pending} pending${failed > 0 ? `, ${failed} failed` : ''}`,
	);

	// Clear screen and render
	process.stdout.write('\x1Bc');
	process.stdout.write(lines.join('\n'));
	process.stdout.write('\n');
}

function truncateError(message: string | undefined): string {
	if (!message) return '';
	if (message.length <= MAX_ERROR_LENGTH) return message;
	return `${message.slice(0, MAX_ERROR_LENGTH - 1)}…`;
}

function formatDuration(seconds?: number): string {
	if (seconds === undefined) {
		return '';
	}
	return `${Math.round(seconds)}s`;
}

function formatCost(cost?: number): string {
	if (typeof cost !== 'number') {
		return '';
	}
	return `$${cost.toFixed(2)}`;
}

function formatRunLine(run: RunProgress, now: number): string {
	const icon = STATUS_ICON[run.status];
	const iterationStr = String(run.request.iteration);
	const spacing = iterationStr.length >= 2 ? '  ' : ' ';
	const prefix = `[${iterationStr}]${spacing}${icon}`;

	if (run.status === 'pending') {
		return `${prefix} Pending`;
	}

	const elapsedMs =
		run.status === 'running'
			? now - (run.startedAt ?? now)
			: (run.finishedAt ?? now) - (run.startedAt ?? now);

	const elapsedSeconds = Math.max(0, Math.round(elapsedMs / 1000));
	const durationDisplay =
		run.status === 'running'
			? `${elapsedSeconds}s elapsed`
			: formatDuration(run.durationSeconds);

	const costDisplay = formatCost(run.cost);
	const details = [
		durationDisplay,
		costDisplay,
		run.turns ? `${run.turns} turns` : '',
	]
		.filter(Boolean)
		.join(', ');

	if (run.status === 'failed') {
		const errorText = truncateError(run.error);
		return `${prefix} Failed${errorText ? ` – ${errorText}` : ''}`;
	}

	return `${prefix} ${run.status === 'success' ? 'Complete' : 'Running'}${
		details ? ` (${details})` : ''
	}`;
}
