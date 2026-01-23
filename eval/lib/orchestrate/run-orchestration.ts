import { spawn } from 'node:child_process';
import os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
	RunEvaluationParams,
	RunEvaluationResult,
} from '../run-evaluation.ts';
import { renderProgressUI } from './progress-ui.ts';
import type { OrchestrationArgs, RunProgress, RunRequest } from './types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = path.resolve(__dirname, '..', '..');
const WORKER_PATH = path.join(
	EVAL_ROOT,
	'lib',
	'orchestrate',
	'run-eval-worker.ts',
);
const LOG_DIR = path.join(EVAL_ROOT, 'orchestration-logs');

type WorkerSuccess = { ok: true; result: RunEvaluationResult; logs: string };
type WorkerFailure = { ok: false; error: string; stack?: string };
type WorkerResponse = WorkerSuccess | WorkerFailure;

type RunResult = {
	variantId: string;
	variantLabel: string;
	duration: number;
	cost?: number;
	turns: number;
	a11yViolations: number;
	testsPassed: number;
	testsFailed: number;
	coverageLines?: number | null;
	experimentFolder?: string;
	logs?: string;
};

export async function runOrchestration(args: OrchestrationArgs): Promise<void> {
	const runRequests = buildRunRequests(args);
	const progress = new Map<string, RunProgress>();
	const results: RunResult[] = [];
	for (const req of runRequests) {
		progress.set(req.id, {
			request: req,
			status: 'pending',
		});
	}

	const render = () =>
		renderProgressUI({
			orchestrationName: args.config.name,
			evalName: args.evalName,
			uploadId: args.uploadId,
			runId: args.runId,
			runs: Array.from(progress.values()).sort((a, b) => {
				if (a.request.variantId !== b.request.variantId) {
					return a.request.variantId.localeCompare(b.request.variantId);
				}
				return a.request.iteration - b.request.iteration;
			}),
		});

	if (runRequests.length > 1) {
		render();
	}

	// Concurrency based on CPU cores (leave one core free if possible)
	const cpuCount = Math.max(1, os.cpus().length);
	const maxParallel = Math.max(
		1,
		Math.min(runRequests.length, cpuCount - 1 || 1),
	);

	const refreshInterval =
		runRequests.length > 1 ? setInterval(render, 1000) : undefined;

	const workerCount = maxParallel;
	let cursor = 0;

	const worker = async (): Promise<void> => {
		while (cursor < runRequests.length) {
			const req = runRequests[cursor]!;
			cursor += 1;
			await runSingle(args, req, progress, render, results);
		}
	};

	await Promise.all(Array.from({ length: workerCount }, () => worker()));

	if (refreshInterval) {
		clearInterval(refreshInterval);
	}

	render();

	printVariantComparison(results);
}

function buildRunRequests(args: OrchestrationArgs): RunRequest[] {
	const variants = args.selectedVariants
		? args.config.variants.filter((v) => args.selectedVariants?.includes(v.id))
		: args.config.variants;

	const requests: RunRequest[] = [];
	for (const variant of variants) {
		for (let iteration = 1; iteration <= args.iterations; iteration += 1) {
			requests.push({
				id: `${variant.id}-${iteration}`,
				variantId: variant.id,
				variantLabel: variant.label,
				iteration,
				context: variant.context,
				agent: variant.agent,
				model: variant.model,
				verbose: variant.verbose,
				storybook: variant.storybook,
				systemPrompts: variant.systemPrompts,
			});
		}
	}
	return requests;
}

function createWorkerPayload(
	args: OrchestrationArgs,
	request: RunRequest,
): RunEvaluationParams {
	const ctx = [...request.context];

	if (args.inlinePrompt) {
		ctx.push({ type: 'inline-prompt', content: args.inlinePrompt });
	}

	if (args.designSystem) {
		ctx.push({
			type: 'inline-prompt',
			content: `Use the design system ${args.designSystem} to build the component.`,
		});
	}

	return {
		evalName: args.evalName,
		context: ctx,
		agent: request.agent,
		model: request.model,
		systemPrompts: request.systemPrompts ?? [],
		uploadId: args.uploadId,
		verbose: request.verbose ?? false,
		storybook: request.storybook,
		runId: args.runId,
		quiet: true,
	};
}

function runWorker(payload: RunEvaluationParams): Promise<WorkerResponse> {
	return new Promise((resolve, reject) => {
		const child = spawn('node', [WORKER_PATH], {
			cwd: EVAL_ROOT,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (data) => {
			stdout += data.toString();
		});
		child.stderr.on('data', (data) => {
			stderr += data.toString();
		});
		child.on('error', (error) => reject(error));
		child.on('close', (code) => {
			if (stdout.trim().length === 0) {
				resolve({
					ok: false,
					error: `Worker exited with code ${code ?? 'unknown'}`,
					stack: stderr || undefined,
				});
				return;
			}

			try {
				const parsed = JSON.parse(stdout) as WorkerResponse;
				resolve(
					parsed.ok
						? { ok: true, result: parsed.result, logs: stderr }
						: parsed,
				);
			} catch (error) {
				resolve({
					ok: false,
					error: `Failed to parse worker output: ${error instanceof Error ? error.message : String(error)}`,
					stack: stderr || undefined,
				});
			}
		});

		child.stdin.write(JSON.stringify(payload));
		child.stdin.end();
	});
}

async function runSingle(
	args: OrchestrationArgs,
	request: RunRequest,
	progress: Map<string, RunProgress>,
	onUpdate: () => void,
	results: RunResult[],
): Promise<void> {
	const current = progress.get(request.id)!;
	current.status = 'running';
	current.startedAt = Date.now();
	onUpdate();

	const payload = createWorkerPayload(args, request);
	const response = await runWorker(payload);

	if (response.ok) {
		const { executionSummary, evaluationSummary } = response.result;
		current.status = 'success';
		current.finishedAt = Date.now();
		current.durationSeconds = executionSummary.duration;
		current.cost = executionSummary.cost;
		current.turns = executionSummary.turns;
		const experimentFolder = path.basename(
			response.result.experimentArgs.experimentPath,
		);
		writeRunLog(experimentFolder, response.logs);
		results.push({
			variantId: request.variantId,
			variantLabel: request.variantLabel,
			duration: executionSummary.duration,
			cost: executionSummary.cost,
			turns: executionSummary.turns,
			a11yViolations: evaluationSummary.a11y.violations,
			testsPassed: evaluationSummary.test.passed,
			testsFailed: evaluationSummary.test.failed,
			coverageLines: evaluationSummary.coverage?.lines ?? null,
			experimentFolder,
			logs: response.logs,
		});
	} else {
		current.status = 'failed';
		current.finishedAt = Date.now();
		current.error = response.error;
	}

	progress.set(request.id, current);
	onUpdate();
}

function printVariantComparison(results: RunResult[]): void {
	if (results.length === 0) {
		return;
	}

	if (!fs.existsSync(LOG_DIR)) {
		fs.mkdirSync(LOG_DIR, { recursive: true });
	}

	const byVariant = new Map<string, { label: string; runs: RunResult[] }>();
	for (const run of results) {
		const entry = byVariant.get(run.variantId) ?? {
			label: run.variantLabel,
			runs: [],
		};
		entry.runs.push(run);
		byVariant.set(run.variantId, entry);
	}

	const metrics = [
		{
			key: 'duration',
			label: 'Duration (s) (less is better)',
			getter: (r: RunResult) => r.duration,
		},
		{
			key: 'cost',
			label: 'Cost ($) (less is better)',
			getter: (r: RunResult) => r.cost,
		},
		{
			key: 'turns',
			label: 'Turns (less is better)',
			getter: (r: RunResult) => r.turns,
		},
		{
			key: 'a11y',
			label: 'A11y Violations (less is better)',
			getter: (r: RunResult) => r.a11yViolations,
		},
		{
			key: 'testsTotal',
			label: 'Tests (total)',
			getter: (r: RunResult) => r.testsPassed + r.testsFailed,
		},
		{
			key: 'testsPassed',
			label: 'Tests (passed)',
			getter: (r: RunResult) => r.testsPassed,
		},
		{
			key: 'testsFailed',
			label: 'Tests (failed)',
			getter: (r: RunResult) => r.testsFailed,
		},
	] as const;

	const statsByVariant: Record<
		string,
		Record<string, { mean: number; sd: number; samples: number }>
	> = {};

	for (const [variantId, entry] of byVariant.entries()) {
		statsByVariant[variantId] = {};
		for (const metric of metrics) {
			const values = entry.runs
				.map((r) => metric.getter(r))
				.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
			if (values.length === 0) continue;
			const mean = values.reduce((a, b) => a + b, 0) / values.length;
			const variance =
				values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
			statsByVariant[variantId]![metric.key] = {
				mean,
				sd: Math.sqrt(variance),
				samples: values.length,
			};
		}
	}

	const variants = Array.from(byVariant.entries());
	const maxLabel = Math.max(...variants.map(([_, v]) => v.label.length));

	process.stdout.write('\nVariant comparison (mean ± sd):\n');
	for (const metric of metrics) {
		process.stdout.write(`\n${metric.label}:\n`);
		const statStrings: Record<string, string> = {};
		let maxStatLen = 0;
		for (const [variantId] of variants) {
			const stat = statsByVariant[variantId]?.[metric.key];
			const statStr = stat
				? `${stat.mean.toFixed(2)} ± ${stat.sd.toFixed(2)}`
				: 'n/a';
			statStrings[variantId] = statStr;
			maxStatLen = Math.max(maxStatLen, statStr.length);
		}

		const maxMean = Math.max(
			...variants
				.map(([id]) => statsByVariant[id]?.[metric.key]?.mean ?? 0)
				.filter((v) => v > 0),
			0,
		);
		for (const [variantId, entry] of variants) {
			const stat = statsByVariant[variantId]?.[metric.key];
			const label = entry.label.padEnd(maxLabel, ' ');
			if (!stat) {
				process.stdout.write(`  ${label} : ${'n/a'.padEnd(maxStatLen, ' ')}\n`);
				continue;
			}
			const bar = renderBar(stat.mean, maxMean || stat.mean);
			const statStr = statStrings[variantId]!.padEnd(maxStatLen, ' ');
			process.stdout.write(`  ${label} : ${statStr} ${bar}\n`);
		}
	}
	process.stdout.write('\n');
}

function renderBar(value: number, maxValue: number): string {
	if (maxValue <= 0) return '';
	const width = 20;
	const filled = Math.max(1, Math.round((value / maxValue) * width));
	return '[' + '#'.repeat(filled).padEnd(width, ' ') + ']';
}

function writeRunLog(experimentFolder: string, logs?: string): void {
	if (!fs.existsSync(LOG_DIR)) {
		fs.mkdirSync(LOG_DIR, { recursive: true });
	}
	const logPath = path.join(LOG_DIR, `${experimentFolder}.log`);
	const cleaned = cleanLogs(logs);
	const content =
		cleaned && cleaned.trim().length > 0
			? cleaned
			: 'No stdout/stderr captured from worker.';
	fs.writeFileSync(logPath, content, 'utf8');
}

function cleanLogs(logs?: string): string {
	if (!logs) return '';
	const ansiRegex = /\x1B\[[0-9;]*[A-Za-z]/g;
	const seen = new Set<string>();
	const lines: string[] = [];
	for (const raw of logs.split('\n')) {
		const line = raw
			.replace(/^__LOG__:[^:]*:/, '')
			.replace(ansiRegex, '')
			.replace(/◒|◓|◑|◐|/g, '')
			.trimEnd()
			.replace(/(\.)+$/g, '');
		if (!line.length) continue;
		if (seen.has(line)) continue;
		seen.add(line);
		lines.push(line);
	}
	return lines.join('\n');
}
