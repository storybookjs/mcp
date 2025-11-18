import { parseArgs } from 'node:util';
import * as v from 'valibot';
import * as p from '@clack/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
	McpServerConfigSchema,
	type Context,
	type McpServerConfig,
} from '../types.ts';

export async function collectArgs() {
	const EVALS_DIR = path.join(process.cwd(), 'evals');

	const nodeParsedArgs = parseArgs({
		options: {
			agent: { type: 'string', short: 'a' },
			verbose: { type: 'boolean', default: false, short: 'v' },
			storybook: { type: 'boolean', short: 's' },
			context: { type: 'string', short: 'c' },
			upload: { type: 'boolean', short: 'u' },
		},
		strict: false,
		allowPositionals: true,
		allowNegative: true,
	});

	// We only support one eval at a time currently
	const ArgPositionalsSchema = v.optional(
		v.pipe(
			v.array(v.string()),
			v.maxLength(1),
			v.transform((arr) => arr[0]),
		),
	);

	const parsedEvalPath = v.parse(
		ArgPositionalsSchema,
		nodeParsedArgs.positionals,
	);

	const ArgValuesSchema = v.objectAsync({
		agent: v.optional(
			v.union([v.literal('claude-code'), v.literal('copilot')]),
		),
		verbose: v.boolean(),
		storybook: v.optional(v.boolean()),
		upload: v.optional(v.boolean()),
		context: v.optionalAsync(
			v.unionAsync([
				// no context
				v.pipe(
					v.literal(false),
					v.transform(() => ({ type: false as const })),
				),
				// the context can be a path to a .json mcp server config if the string includes "mcp"
				v.pipeAsync(
					v.string(),
					v.includes('mcp'),
					v.endsWith('.json'),
					v.transformAsync(async (filePath) => {
						if (!parsedEvalPath) {
							throw new TypeError(
								'To set an mcp config file as the context, you must also set the eval as a positional argument',
							);
						}
						return (
							await import(path.join(EVALS_DIR, parsedEvalPath, filePath), {
								with: { type: 'json' },
							})
						).default;
					}),
					McpServerConfigSchema,
					v.transform((config) => ({
						type: 'mcp-server' as const,
						mcpServerConfig: config,
					})),
				),
				// ... or the mcp server config directly inline
				v.pipe(
					v.string(),
					v.parseJson(),
					McpServerConfigSchema,
					v.transform((config) => ({
						type: 'mcp-server' as const,
						mcpServerConfig: config,
					})),
				),
				// ... or a component manifest to be used with @storybook/mcp
				v.pipe(
					v.pipe(v.string(), v.endsWith('.json')),
					v.transform((manifestPath) => ({
						type: 'components-manifest' as const,
						manifestPath,
					})),
				),
				// ... or one or more comma-separated extra prompts from the eval root
				v.pipe(
					v.pipe(v.string(), v.endsWith('.md')),
					v.transform((prompts) => ({
						type: 'extra-prompts' as const,
						prompts: prompts.split(',').map((p) => p.trim()),
					})),
				),
			]),
		),
	});

	const parsedArgValues = await v.parseAsync(
		ArgValuesSchema,
		nodeParsedArgs.values,
	);

	// Build rerun command incrementally
	const rerunCommandParts: string[] = ['node', 'eval.ts'];

	// Get available eval directories
	const availableEvals = await fs.readdir(EVALS_DIR, { withFileTypes: true });
	const evalOptions = availableEvals
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => ({
			value: dirent.name,
			label: dirent.name,
		}));

	const evalPromptResult =
		parsedEvalPath ??
		(
			await p.select({
				message: 'Which eval do you want to run?',
				options: evalOptions,
			})
		).toString();

	if (parsedArgValues.storybook !== undefined) {
		rerunCommandParts.push(
			`--${parsedArgValues.storybook ? '' : 'no-'}storybook`,
		);
	}

	// Prompt for missing arguments
	const promptResults = await p.group(
		{
			agent: async () => {
				if (parsedArgValues.agent) {
					rerunCommandParts.push('--agent', parsedArgValues.agent);
					return parsedArgValues.agent;
				}

				const result = await p.select({
					message: 'Which coding agents do you want to use?',
					options: [{ value: 'claude-code', label: 'Claude Code CLI' }],
				});

				if (p.isCancel(result)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}

				rerunCommandParts.push('--agent', result.toString());
				return result;
			},
			context: async function (): Promise<Context> {
				const evalPath = path.resolve(path.join('evals', evalPromptResult));

				if (parsedArgValues.context !== undefined) {
					switch (parsedArgValues.context.type) {
						case 'mcp-server': {
							rerunCommandParts.push(
								'--context',
								`'${JSON.stringify(parsedArgValues.context.mcpServerConfig)}'`,
							);
							break;
						}
						case 'extra-prompts': {
							rerunCommandParts.push(
								'--context',
								parsedArgValues.context.prompts.join(','),
							);
							break;
						}
						case 'components-manifest': {
							rerunCommandParts.push(
								'--context',
								`'${JSON.stringify(parsedArgValues.context.manifestPath)}'`,
							);
							return {
								type: 'components-manifest',
								mcpServerConfig: manifestPathToMcpServerConfig(
									path.join(evalPath, parsedArgValues.context.manifestPath),
								),
							};
						}
						case false: {
							rerunCommandParts.push('--no-context');
							break;
						}
					}
					return parsedArgValues.context;
				}

				const availableExtraPrompts: Record<string, string> = {};
				const availableManifests: Record<string, string[]> = {};
				for (const dirent of await fs.readdir(evalPath, {
					withFileTypes: true,
				})) {
					if (!dirent.isFile()) {
						continue;
					}
					if (dirent.name.endsWith('.json') && !dirent.name.includes('mcp')) {
						const { default: manifestContent } = await import(
							path.join(evalPath, dirent.name),
							{
								with: { type: 'json' },
							}
						);
						availableManifests[dirent.name] = Object.keys(
							manifestContent.components || {},
						);
					} else if (
						dirent.name.endsWith('.md') &&
						dirent.name !== 'prompt.md'
					) {
						const content = await fs.readFile(
							path.join(evalPath, dirent.name),
							'utf8',
						);
						availableExtraPrompts[dirent.name] = content;
					}
				}

				const mainSelection = await p.select<false | string>({
					message: 'Which additional context should the agent have?',
					options: [
						{
							label: 'None',
							hint: 'No additional context beyond the prompt and default tools',
							value: false,
						},
						{
							label: 'Storybook MCP server',
							hint:
								Object.keys(availableManifests).length > 0
									? 'Add a Storybook MCP server based on a components manifest file'
									: 'No component manifest files available for this eval',
							value: 'components-manifest',
							disabled: Object.keys(availableManifests).length === 0,
						},
						{
							label: 'Generic MCP server',
							hint: 'Add an MCP server to the agent',
							value: 'mcp-server',
						},
						{
							label: 'Extra prompts',
							hint:
								Object.keys(availableExtraPrompts).length > 0
									? 'Include any of the additional prompts from the eval'
									: 'No additional prompts available for this eval',
							value: 'extra-prompts',
							disabled: Object.keys(availableExtraPrompts).length === 0,
						},
					],
				});

				switch (mainSelection) {
					case false: {
						rerunCommandParts.push('--no-context');
						return { type: false };
					}
					case 'components-manifest': {
						const manifestOptions = Object.entries(availableManifests).map(
							([manifestPath, componentNames]) => ({
								label: manifestPath,
								hint: `${componentNames.length} components: ${componentNames.slice(0, 5).join(', ')}...`,
								value: manifestPath,
							}),
						);

						const selectedManifestPath = await p.select({
							message:
								'Which components manifest should be used for the Storybook MCP?',
							options: manifestOptions,
						});
						if (p.isCancel(selectedManifestPath)) {
							p.cancel('Operation cancelled.');
							process.exit(0);
						}

						rerunCommandParts.push('--context', selectedManifestPath);
						return {
							type: mainSelection,
							mcpServerConfig: manifestPathToMcpServerConfig(
								path.join(evalPath, selectedManifestPath),
							),
						};
					}

					case 'mcp-server': {
						const mcpServerName = await p.text({
							message: 'What name should be used for the MCP server?',
							initialValue: 'storybook-mcp',
						});
						if (p.isCancel(mcpServerName)) {
							p.cancel('Operation cancelled.');
							process.exit(0);
						}

						const mcpServerType = await p.select({
							message: 'What type of MCP server is this?',
							options: [
								{
									label: 'HTTP',
									hint: 'Server exposed over HTTP (e.g., http://localhost:6006/mcp)',
									value: 'http',
								},
								{
									label: 'stdio',
									hint: 'Server running as a subprocess with stdio communication',
									value: 'stdio',
								},
							],
						});
						if (p.isCancel(mcpServerType)) {
							p.cancel('Operation cancelled.');
							process.exit(0);
						}

						if (mcpServerType === 'http') {
							const mcpServerUrl = await p.text({
								message:
									'What is the URL for the MCP server? (http://localhost:6006/mcp)',
								initialValue: 'http://localhost:6006/mcp',
							});
							if (p.isCancel(mcpServerUrl)) {
								p.cancel('Operation cancelled.');
								process.exit(0);
							}
							const config: McpServerConfig = {
								[mcpServerName]: { type: 'http', url: mcpServerUrl },
							};
							rerunCommandParts.push(
								'--context',
								`'${JSON.stringify(config)}'`,
							);
							return {
								type: mainSelection,
								mcpServerConfig: config,
							};
						} else {
							const mcpServerCommand = await p.text({
								message:
									'What is the full command to run the MCP server? (command AND any args)',
								placeholder: 'node server.js --port 8080',
							});
							if (p.isCancel(mcpServerCommand)) {
								p.cancel('Operation cancelled.');
								process.exit(0);
							}
							const [command, ...argsParts] = mcpServerCommand.split(' ');

							const config: McpServerConfig = {
								[mcpServerName]: {
									type: 'stdio',
									command: command!,
									args: argsParts.length > 0 ? argsParts : undefined,
								},
							};
							rerunCommandParts.push(
								'--context',
								`'${JSON.stringify(config)}'`,
							);
							return {
								type: mainSelection,
								mcpServerConfig: config,
							};
						}
					}
					case 'extra-prompts': {
						const extraPromptOptions = Object.entries(
							availableExtraPrompts,
						).map(([name, content]) => ({
							label: name,
							hint:
								content.slice(0, 100).replace(/\n/g, ' ') +
								(content.length > 100 ? '...' : ''),
							value: name,
						}));

						const selectedExtraPromptNames = await p.multiselect({
							message: 'Which extra prompts should be included as context?',
							options: extraPromptOptions,
						});
						if (p.isCancel(selectedExtraPromptNames)) {
							p.cancel('Operation cancelled.');
							process.exit(0);
						}

						for (const name of selectedExtraPromptNames) {
							rerunCommandParts.push('--context', name);
						}
						return { type: mainSelection, prompts: selectedExtraPromptNames };
					}
				}

				if (p.isCancel(mainSelection)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}
				throw new Error('Unreachable context selection');
			},
			verbose: async () => {
				if (parsedArgValues.verbose) {
					rerunCommandParts.push('--verbose');
				}
				return parsedArgValues.verbose;
			},
			upload: async () => {
				if (parsedArgValues.upload !== undefined) {
					rerunCommandParts.push(
						`--${parsedArgValues.upload ? '' : 'no-'}upload`,
					);
					return parsedArgValues.upload;
				}

				const result = await p.confirm({
					message:
						'Do you want to upload the results to a public Google Sheet at the end of the run?',
					initialValue: true,
				});
				if (p.isCancel(result)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}

				rerunCommandParts.push(`--${result ? '' : 'no-'}upload`);
				return result;
			},
		},
		{
			onCancel: () => {
				p.cancel('Operation cancelled.');
				process.exit(0);
			},
		},
	);

	const result = {
		agent: promptResults.agent,
		verbose: promptResults.verbose,
		eval: evalPromptResult,
		context: promptResults.context,
		storybook: parsedArgValues.storybook,
		upload: promptResults.upload,
	};

	rerunCommandParts.push(evalPromptResult);
	p.log.message([
		'To re-run this experiment, call:',
		rerunCommandParts.join(' '),
	]);

	return result;
}

function manifestPathToMcpServerConfig(manifestPath: string): McpServerConfig {
	return {
		'storybook-mcp': {
			type: 'stdio',
			command: 'node',
			args: [
				path.join(process.cwd(), '..', 'packages', 'mcp', 'bin.ts'),
				'--manifestPath',
				manifestPath,
			],
		},
	};
}
