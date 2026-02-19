import * as p from '@clack/prompts';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { EvalArgs, VariantConfig, VariantConfigInput } from './types.ts';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_MODELS } from '../../types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = path.resolve(__dirname, '..', '..');
const VARIANT_CONFIGS_DIR = path.join(EVAL_ROOT, 'variant-configs');
const TASKS_DIR = path.join(EVAL_ROOT, 'tasks');

type LoadedConfig = {
	filename: string;
	config: VariantConfigInput;
};

type EvalCliArgs = {
	includeInternal: boolean;
};

export async function collectEvalArgs(): Promise<EvalArgs> {
	const cliArgs = parseEvalCliArgs(process.argv.slice(2));
	const configs = await loadVariantConfigs();
	const config = await chooseConfig(configs, cliArgs.includeInternal);

	const hasVariantTaskNames = config.variants.some((variant) => Boolean(variant.taskName));
	const allVariantsHaveTaskNames = config.variants.every((variant) => Boolean(variant.taskName));

	if (hasVariantTaskNames && !allVariantsHaveTaskNames) {
		throw new Error(
			`Config "${config.name}" mixes variants with and without taskName. Either all variants must set taskName or none should.`,
		);
	}

	const designSystem = allVariantsHaveTaskNames ? undefined : await chooseDesignSystem();
	const taskName = allVariantsHaveTaskNames ? undefined : await chooseTaskName(designSystem!);
	const selectedVariants = await chooseVariants(config.variants);

	// Only prompt for model if at least one variant is missing it
	const needsModel = config.variants.some((v) => !v.model);
	const model = needsModel ? await chooseModel() : undefined;

	const iterations = await askIterations();
	const parallelism = await askParallelism();
	const uploadId = await askUploadId();
	const runId = randomUUID();

	const normalizedConfig: VariantConfig = {
		...config,
		variants: config.variants.map((v) => ({
			...v,
			agent: v.agent ?? 'claude-code',
			model: v.model ?? model!,
		})),
	};

	const variantsToRun = selectedVariants
		? normalizedConfig.variants.filter((v) => selectedVariants.includes(v.id))
		: normalizedConfig.variants;

	const totalIterations = variantsToRun.length * iterations;
	const agentName = variantsToRun[0]!.agent;
	const modelName = variantsToRun[0]!.model;

	const confirmed = await p.confirm({
		message: `This will run ${totalIterations} total iterations with the ${agentName} agent using the ${modelName} model. Are you sure you want to start this?`,
		initialValue: true,
	});

	ensureNotCancelled(confirmed);

	if (!confirmed) {
		p.cancel('Operation cancelled.');
		process.exit(0);
	}

	return {
		taskName,
		config: normalizedConfig,
		iterations,
		parallelism,
		uploadId,
		runId,
		designSystem,
		selectedVariants,
	};
}

function parseEvalCliArgs(args: string[]): EvalCliArgs {
	let includeInternal = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]!;
		if (arg === '--internal') {
			includeInternal = true;
			continue;
		}

		if (arg === '--no-internal') {
			includeInternal = false;
			continue;
		}
	}

	return { includeInternal };
}

function ensureNotCancelled<T>(value: T): asserts value is Exclude<T, symbol> {
	if (p.isCancel(value)) {
		p.cancel('Operation cancelled.');
		process.exit(0);
	}
}

async function loadVariantConfigs(): Promise<LoadedConfig[]> {
	const dirExists = await fs
		.access(VARIANT_CONFIGS_DIR)
		.then(() => true)
		.catch(() => false);

	if (!dirExists) {
		throw new Error(
			'Variant configs directory not found. Expected eval/variant-configs relative to the eval package.',
		);
	}

	const files = await fs.readdir(VARIANT_CONFIGS_DIR, { withFileTypes: true });
	const tsFiles = files
		.filter((dirent) => dirent.isFile())
		.filter((dirent) => dirent.name.endsWith('.ts') || dirent.name.endsWith('.js'));

	const configs: LoadedConfig[] = [];
	for (const file of tsFiles) {
		const fullPath = path.join(VARIANT_CONFIGS_DIR, file.name);
		// Dynamic import to load config
		const mod = await import(fullPath);
		const config = (mod.default ?? mod) as VariantConfig;
		configs.push({ filename: file.name, config });
	}

	if (configs.length === 0) {
		throw new Error('No variant config files found in eval/variant-configs');
	}

	return configs;
}

async function chooseDesignSystem(): Promise<string> {
	const taskOptions = (await fs.readdir(TASKS_DIR, { withFileTypes: true }))
		.filter((dirent) => dirent.isDirectory())
		.filter((dirent) => !dirent.name.startsWith('9')) // 9XX tasks are internal
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
	const taskOptions = (await fs.readdir(TASKS_DIR, { withFileTypes: true }))
		.filter((dirent) => dirent.isDirectory())
		.filter((dirent) => dirent.name.endsWith(designSystem))
		.filter((dirent) => !dirent.name.startsWith('9')) // 9XX tasks are internal
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
	includeInternal: boolean,
): Promise<VariantConfigInput> {
	const selectableConfigs = includeInternal
		? configs
		: configs.filter((loaded) => !loaded.config.internal);

	if (selectableConfigs.length === 0) {
		throw new Error(
			'No variant config files available for selection. Re-run with --internal to include internal configs.',
		);
	}

	if (selectableConfigs.length === 1) {
		return selectableConfigs[0]!.config;
	}

	const selected = await p.select({
		message: 'Select an eval configuration',
		options: selectableConfigs.map((c) => ({
			value: c.filename,
			label: c.config.name,
			hint: c.config.description,
		})),
	});

	ensureNotCancelled(selected);
	const found = selectableConfigs.find((c) => c.filename === selected);
	if (!found) {
		throw new Error(`Variant config not found: ${selected}`);
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

async function askParallelism(): Promise<number | undefined> {
	const parallelism = await p.text({
		message: 'Max parallel workers? (leave blank to auto-detect from CPU cores)',
		placeholder: 'auto',
	});

	ensureNotCancelled(parallelism);
	if (!parallelism || parallelism.trim() === '') {
		return undefined;
	}
	const parsed = parseInt(parallelism, 10);
	if (Number.isNaN(parsed) || parsed < 1) {
		return undefined;
	}
	return parsed;
}

async function askUploadId(): Promise<string | false> {
	const uploadId = await p.text({
		message: 'Enter an Upload ID to upload results to Google Sheet (leave blank to skip):',
		placeholder: 'trial-batch-1',
	});

	ensureNotCancelled(uploadId);
	const resolved = uploadId;
	return resolved || false;
}

async function chooseVariants(
	variants: VariantConfigInput['variants'],
): Promise<string[] | undefined> {
	if (variants.length <= 1) {
		return undefined;
	}

	const selected = await p.multiselect({
		message: 'Which variants should be executed? (leave empty to run all variants)',
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

async function chooseModel(): Promise<(typeof CLAUDE_MODELS)[number]> {
	const result = await p.select({
		message: 'Which model should the agent use?',
		options: CLAUDE_MODELS.map((m) => ({ value: m, label: m })),
	});
	ensureNotCancelled(result);
	return result as (typeof CLAUDE_MODELS)[number];
}
