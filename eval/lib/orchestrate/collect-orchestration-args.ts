import * as p from '@clack/prompts';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { OrchestrationArgs, OrchestrationConfig } from './types.ts';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agents } from '../../config.ts';
import { SUPPORTED_MODELS } from '../../types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = path.resolve(__dirname, '..', '..');
const ORCHESTRATIONS_DIR = path.join(EVAL_ROOT, 'orchestrations');
const TASKS_DIR = path.join(EVAL_ROOT, 'tasks');

type LoadedConfig = {
	filename: string;
	config: OrchestrationConfig;
};

export async function collectOrchestrationArgs(): Promise<OrchestrationArgs> {
	const configs = await loadOrchestrationConfigs();
	const designSystem = await chooseDesignSystem();
	const taskName = await chooseTaskName(designSystem);
	const config = await chooseConfig(configs);
	const iterations = await askIterations();
	const uploadId = await askUploadId();
	const defaultRunId = randomUUID();

	const advancedMode = process.argv.includes('--advanced-mode');

	let agent: keyof typeof agents | undefined = undefined;
	let model: (typeof SUPPORTED_MODELS)[number] | undefined = undefined;
	let selectedVariants: string[] | undefined = undefined;
	let runId: string | undefined = defaultRunId;

	if (advancedMode) {
		agent = await chooseAgent();
		model = await chooseModel();
		selectedVariants = await chooseVariants(config.variants);
		runId = await askRunId(defaultRunId);
	}

	const normalizedConfig: OrchestrationConfig = {
		...config,
		variants: config.variants.map((v) => ({
			...v,
			agent: v.agent ?? agent,
			model: v.model ?? model,
		})),
	};

	return {
		taskName,
		config: normalizedConfig,
		iterations,
		uploadId,
		runId,
		advancedMode,
		designSystem,
		selectedVariants,
	};
}

function ensureNotCancelled<T>(value: T): asserts value is Exclude<T, symbol> {
	if (p.isCancel(value)) {
		p.cancel('Operation cancelled.');
		process.exit(0);
	}
}

async function loadOrchestrationConfigs(): Promise<LoadedConfig[]> {
	const dirExists = await fs
		.access(ORCHESTRATIONS_DIR)
		.then(() => true)
		.catch(() => false);

	if (!dirExists) {
		throw new Error(
			'Orchestration directory not found. Expected eval/orchestrations relative to the eval package.',
		);
	}

	const files = await fs.readdir(ORCHESTRATIONS_DIR, { withFileTypes: true });
	const tsFiles = files
		.filter((dirent) => dirent.isFile())
		.filter(
			(dirent) => dirent.name.endsWith('.ts') || dirent.name.endsWith('.js'),
		);

	const configs: LoadedConfig[] = [];
	for (const file of tsFiles) {
		const fullPath = path.join(ORCHESTRATIONS_DIR, file.name);
		// Dynamic import to load config
		const mod = await import(fullPath);
		const config = (mod.default ?? mod) as OrchestrationConfig;
		configs.push({ filename: file.name, config });
	}

	if (configs.length === 0) {
		throw new Error(
			'No orchestration config files found in eval/orchestrations',
		);
	}

	return configs;
}

async function chooseDesignSystem(): Promise<string> {
	const taskOptions = (await fs.readdir(TASKS_DIR, { withFileTypes: true }))
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => ({
			value: dirent.name.split('-').at(-1)!,
			label: dirent.name.split('-').at(-1)!,
		}))
		// filter unique by label
		.flatMap((value, index, self) =>
			self.findIndex((t) => t.label === value.label) === index ? value : null,
		)
		.filter((value) => value !== null);

	const taskName = await p.select({
		message: 'Which design system do you want to use?',
		options: taskOptions,
	});

	ensureNotCancelled(taskName);
	return String(taskName);
}

async function chooseTaskName(designSystem: string): Promise<string> {
	// Temporary blacklist for tasks which we don't want to expose for now
	const BLACK_LISTED_TASKS = [
		'111-create-component-atom-reshaped',
		'112-create-component-composite-reshaped',
		'113-create-component-async-fetch-reshaped',
		'114-create-component-async-module-reshaped',
		'115-existing-component-write-story-reshaped',
		'116-existing-component-edit-story-reshaped',
		'117-existing-component-change-component-reshaped',
	];

	const taskOptions = (await fs.readdir(TASKS_DIR, { withFileTypes: true }))
		.filter((dirent) => dirent.isDirectory())
		.filter((dirent) => dirent.name.endsWith(designSystem))
		.filter((dirent) => !BLACK_LISTED_TASKS.includes(dirent.name))
		.map((dirent) => ({
			value: dirent.name,
			label: dirent.name,
		}));

	if (taskOptions.length === 1) {
		return taskOptions[0]!.value;
	}

	const taskName = await p.select({
		message: 'Which task do you want to run?',
		options: taskOptions,
	});

	ensureNotCancelled(taskName);
	return String(taskName);
}

async function chooseConfig(
	configs: LoadedConfig[],
): Promise<OrchestrationConfig> {
	if (configs.length === 1) {
		return configs[0]!.config;
	}

	const selected = await p.select({
		message: 'Select an orchestration configuration',
		options: configs.map((c) => ({
			value: c.filename,
			label: c.config.name,
			hint: c.config.description,
		})),
	});

	ensureNotCancelled(selected);
	const found = configs.find((c) => c.filename === selected);
	if (!found) {
		throw new Error(`Orchestration config not found: ${selected}`);
	}

	return found.config;
}

async function askIterations(): Promise<number> {
	const iterations = await p.text({
		message: 'How many iterations per variant?',
		defaultValue: '10',
		placeholder: '10',
	});

	ensureNotCancelled(iterations);
	return parseInt(iterations, 10);
}

async function askUploadId(): Promise<string | false> {
	const uploadId = await p.text({
		message:
			'Enter an Upload ID to upload results to Google Sheet (leave blank to skip):',
		placeholder: 'experiment-batch-1',
	});

	ensureNotCancelled(uploadId);
	const resolved = uploadId;
	return resolved || false;
}

async function askRunId(defaultRunId: string): Promise<string> {
	const runId = await p.text({
		message: 'Enter a Run ID (leave blank to use the generated one):',
		placeholder: defaultRunId,
		initialValue: defaultRunId,
	});

	ensureNotCancelled(runId);
	const resolved = runId;
	return resolved || defaultRunId;
}

async function chooseVariants(
	variants: OrchestrationConfig['variants'],
): Promise<string[] | undefined> {
	if (variants.length <= 1) {
		return undefined;
	}

	const selected = await p.multiselect({
		message:
			'Which variants should be executed? (leave empty to run all variants)',
		options: variants.map((variant) => ({
			value: variant.id,
			label: variant.label,
		})),
		required: false,
	});

	ensureNotCancelled(selected);
	const chosen = selected ?? [];
	return chosen.length > 0 ? chosen : undefined;
}

async function chooseAgent(): Promise<keyof typeof agents> {
	const result = await p.select({
		message: 'Which coding agent do you want to use?',
		options: Object.keys(agents).map((a) => ({ value: a, label: a })),
	});
	ensureNotCancelled(result);
	return result as keyof typeof agents;
}

async function chooseModel(): Promise<(typeof SUPPORTED_MODELS)[number]> {
	const result = await p.select({
		message: 'Which model should the agent use?',
		options: SUPPORTED_MODELS.map((m) => ({ value: m, label: m })),
	});
	ensureNotCancelled(result);
	return result as (typeof SUPPORTED_MODELS)[number];
}
