import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type TrialCandidate = {
	trialPath: string;
	projectPath: string;
	sortKey: number;
};

function parseTrialTimestampMs(trialDirName: string): number | undefined {
	// Trial dir name starts with `YYYY-MM-DDTHH-MM-SS-...`
	const prefix = trialDirName.slice(0, 19);
	if (prefix.length !== 19) return undefined;

	const isoLike = prefix.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
	const ms = Date.parse(isoLike);
	return Number.isFinite(ms) ? ms : undefined;
}

async function resolveTaskPattern(evalDir: string, taskArg?: string): Promise<string | undefined> {
	if (!taskArg) return undefined;

	if (taskArg.includes('..') || taskArg.includes('/') || taskArg.includes('\\')) {
		throw new Error(`--task must not contain path segments. Got: ${taskArg}`);
	}

	// Support passing just the task number, e.g. "909".
	if (/^\d+$/.test(taskArg)) {
		const tasksDir = path.join(evalDir, 'tasks');
		let entries: string[];
		try {
			entries = await fs.readdir(tasksDir);
		} catch {
			throw new Error(`Could not read tasks directory at: ${tasksDir}`);
		}

		const matches = entries.filter((name) => name.startsWith(`${taskArg}-`));
		if (matches.length === 0) {
			throw new Error(`No task directory found starting with '${taskArg}-' under ${tasksDir}`);
		}
		if (matches.length > 1) {
			throw new Error(
				`Task number '${taskArg}' is ambiguous. Matches: ${matches.join(', ')}. Pass the full directory name.`,
			);
		}
		return matches[0];
	}

	return taskArg;
}

async function listTrialCandidates(
	evalDir: string,
	options: { taskName?: string } = {},
): Promise<TrialCandidate[]> {
	const candidates: TrialCandidate[] = [];

	const taskPattern = options.taskName ?? '*';

	const pattern = `tasks/${taskPattern}/trials/*/project`;

	for await (const projectPathRel of glob(pattern, { cwd: evalDir })) {
		const projectPath = path.resolve(evalDir, projectPathRel);
		const trialPath = path.dirname(projectPath);
		const trialDirName = path.basename(trialPath);

		const parsed = parseTrialTimestampMs(trialDirName);
		let sortKey = parsed ?? 0;

		if (!parsed) {
			try {
				const stat = await fs.stat(trialPath);
				sortKey = stat.mtimeMs;
			} catch {
				// ignore
			}
		}

		candidates.push({ trialPath, projectPath, sortKey });
	}

	candidates.sort((a, b) => b.sortKey - a.sortKey);
	return candidates;
}

async function main(): Promise<void> {
	const program = new Command();

	program
		.name('start-trial-storybook')
		.description(
			'Start Storybook for the most recent eval trial project (or go further back with --back).',
		)
		.option(
			'--back <n>',
			'How many trials to go back from the most recent (0 = latest, 1 = previous, ...)',
			(value) => Number.parseInt(value, 10),
			0,
		)
		.option(
			'--task <name>',
			'Only consider trials under this task (e.g. 909-create-component-and-run-story-tests)',
		);

	program.parse(process.argv);
	const opts = program.opts<{ back: number; task?: string }>();
	const back = Number.isFinite(opts.back) ? opts.back : 0;
	const taskArg = opts.task?.trim() || undefined;

	if (!Number.isInteger(back) || back < 0) {
		throw new Error(`--back must be a non-negative integer. Got: ${String(opts.back)}`);
	}

	const evalDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
	const taskName = await resolveTaskPattern(evalDir, taskArg);
	const candidates = await listTrialCandidates(evalDir, { taskName });

	if (candidates.length === 0) {
		throw new Error(
			taskArg
				? `No trial projects found for task '${taskArg}'. Run an eval/advanced-eval for that task first.`
				: 'No trial projects found. Run an eval/advanced-eval first so `tasks/*/trials/*/project` exists.',
		);
	}

	const chosen = candidates[back];
	if (!chosen) {
		throw new Error(
			`Requested --back ${back}, but only found ${candidates.length} trial(s). Try a smaller number.`,
		);
	}

	// Keep this aligned with the harness defaults: storybook should not auto-open.
	const child = spawn('pnpm', ['run', 'storybook', '--no-open'], {
		cwd: chosen.projectPath,
		stdio: 'inherit',
		env: process.env,
	});

	child.on('exit', (code, signal) => {
		if (signal) process.exitCode = 1;
		else process.exitCode = code ?? 1;
	});

	process.on('SIGINT', () => {
		child.kill('SIGINT');
	});

	process.on('SIGTERM', () => {
		child.kill('SIGTERM');
	});
}

await main();
