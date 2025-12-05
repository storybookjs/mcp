import { loadEnvFile } from 'node:process';
import { Command, Option } from 'commander';
import * as p from '@clack/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as v from 'valibot';
import {
	McpServerConfigSchema,
	type Context,
	type McpServerConfig,
} from '../types.ts';

export type CollectedArgs = {
	agent: string;
	verbose: boolean;
	eval: string;
	context: Context;
	storybook: boolean | undefined;
	uploadId: string | false;
};

/**
 * Parse a string value as a boolean.
 * Returns true for "true", "1", "yes"; false for "false", "0", "no"; undefined otherwise.
 */
function parseBooleanEnv(
	value: boolean | undefined,
	envName: string,
): boolean | undefined {
	if (value !== undefined) {
		// don't read from env if value is set by CLI flag
		return value;
	}
	const envVar = process.env[envName];
	if (!envVar) {
		return undefined;
	}

	const normalized = envVar.toLowerCase().trim();
	if (['true', '1', 'yes'].includes(normalized)) {
		return true;
	}
	if (['false', '0', 'no'].includes(normalized)) {
		return false;
	}
	return undefined;
}
/**
 * Intermediate parsed context before full resolution.
 * For components-manifest, we store the path temporarily before converting to mcpServerConfig.
 */
type ParsedContext =
	| { type: false }
	| { type: 'extra-prompts'; prompts: string[] }
	| { type: 'mcp-server'; mcpServerConfig: McpServerConfig }
	| { type: 'components-manifest'; manifestPath: string };

/**
 * Parse a raw context string value into a ParsedContext object.
 * Returns undefined if no context was provided (will trigger interactive prompt).
 */
async function parseContextValue(
	rawContext: string | boolean | undefined,
	evalName: string | undefined,
): Promise<ParsedContext | undefined> {
	const EVALS_DIR = path.join(process.cwd(), 'evals');

	// --no-context sets context to false
	if (rawContext === false) {
		return { type: false };
	}

	// No context provided
	if (rawContext === undefined || rawContext === true) {
		return undefined;
	}

	// Try to parse as JSON (inline MCP config)
	try {
		const parsed = JSON.parse(rawContext);
		const validated = v.parse(McpServerConfigSchema, parsed);
		return { type: 'mcp-server', mcpServerConfig: validated };
	} catch {
		// Not valid JSON, continue with other patterns
	}

	// MCP config file (contains "mcp" and ends with .json)
	if (rawContext.includes('mcp') && rawContext.endsWith('.json')) {
		if (!evalName) {
			throw new Error(
				'To set an MCP config file as the context, you must also set the eval as a positional argument',
			);
		}
		const configPath = path.join(EVALS_DIR, evalName, rawContext);
		const { default: config } = await import(configPath, {
			with: { type: 'json' },
		});
		const validated = v.parse(McpServerConfigSchema, config);
		return { type: 'mcp-server', mcpServerConfig: validated };
	}

	// Components manifest file (ends with .json but no "mcp")
	if (rawContext.endsWith('.json')) {
		return { type: 'components-manifest', manifestPath: rawContext };
	}

	// Extra prompts (ends with .md, can be comma-separated)
	if (rawContext.endsWith('.md')) {
		const prompts = rawContext.split(',').map((p) => p.trim());
		return { type: 'extra-prompts', prompts };
	}

	throw new Error(`Unable to parse context value: ${rawContext}`);
}

/**
 * Build a rerun command from the final collected arguments.
 */
function buildRerunCommand(args: CollectedArgs): string {
	const parts: string[] = ['node', 'eval.ts'];

	parts.push('--agent', args.agent);

	if (args.verbose) {
		parts.push('--verbose');
	}

	if (args.storybook !== undefined) {
		parts.push(args.storybook ? '--storybook' : '--no-storybook');
	}

	switch (args.context.type) {
		case false:
			parts.push('--no-context');
			break;
		case 'mcp-server':
			parts.push(`--context='${JSON.stringify(args.context.mcpServerConfig)}'`);
			break;
		case 'components-manifest': {
			// Extract the manifest path from the mcpServerConfig args
			const serverConfig = args.context.mcpServerConfig['storybook-mcp'];
			const manifestArg =
				serverConfig?.type === 'stdio'
					? serverConfig.args?.find((arg: string) => arg.endsWith('.json'))
					: undefined;
			if (manifestArg) {
				const manifestFileName = path.basename(manifestArg);
				parts.push(`--context=${manifestFileName}`);
			}
			break;
		}
		case 'extra-prompts':
			parts.push(`--context=${args.context.prompts.join(',')}`);
			break;
	}

	if (args.uploadId) {
		parts.push(`--upload-id=${args.uploadId}`);
	} else {
		parts.push('--no-upload-id');
	}

	parts.push(args.eval);

	return parts.join(' ');
}

const HELP_EXAMPLES = `
Examples:
  $ node eval.ts                                    Interactive mode (recommended)
  $ node eval.ts 100-flight-booking-plain           Run specific eval
  $ node eval.ts --agent claude-code --context components.json 100-flight-booking-plain
  $ node eval.ts -v --context extra-prompt-01.md,extra-prompt-02.md 100-flight-booking-plain
  $ node eval.ts --context mcp.config.json 110-flight-booking-reshaped

Context Modes:
  None                Agent uses only built-in tools (--no-context)
  Component Manifest  Provides component docs via @storybook/mcp (--context file.json)
  MCP Server          Custom MCP server config (--context mcp.config.json or inline JSON)
  Extra Prompts       Append markdown instructions (--context file1.md,file2.md)

Learn More: eval/README.md
`;

export async function collectArgs(): Promise<CollectedArgs> {
	const EVALS_DIR = path.join(process.cwd(), 'evals');

	// Load .env file - CLI args will override these
	try {
		loadEnvFile(path.join(process.cwd(), '.env'));
	} catch {
		// File doesn't exist or can't be read - that's fine, env vars are optional
	}

	// Configure Commander program
	const program = new Command()
		.name('eval.ts')
		.description(
			'A CLI tool for testing AI coding agents with Storybook and MCP tools.',
		)
		.argument('[eval-name]', 'Name of the eval directory in evals/')
		.addOption(
			new Option('-a, --agent <name>', 'Which coding agent to use')
				.choices(['claude-code'])
				.env('AGENT'),
		)
		// we don't want to use commander's built in env-handling for boolean values, as it will coearce to true even when the env var is set to 'false'
		.addOption(
			new Option(
				'-v, --verbose',
				'Show detailed logs during execution (env: VERBOSE)',
			),
		)
		.addOption(
			new Option(
				'-s, --storybook',
				'Auto-start Storybook after evaluation (env: STORYBOOK)',
			),
		)
		.addOption(
			new Option(
				'--no-storybook',
				'Do not auto-start Storybook after evaluation (env: STORYBOOK)',
			),
		)
		.addOption(
			new Option(
				'-c, --context <value>',
				'Additional context for the agent (file path or JSON)',
			).env('CONTEXT'),
		)
		.addOption(
			new Option('--no-context', 'No additional context beyond the prompt'),
		)
		.addOption(
			new Option(
				'-u, --upload-id <id>',
				'Upload results to Google Sheet with this ID',
			)
				.env('UPLOAD_ID')
				.argParser((value) => (value === 'false' ? false : value)),
		)
		.addOption(new Option('--no-upload-id', 'Skip uploading results'))
		.addHelpText('after', HELP_EXAMPLES);

	await program.parseAsync();

	const opts = program.opts<{
		agent?: string;
		verbose: boolean;
		storybook?: boolean;
		context?: string | boolean;
		uploadId?: boolean | string;
	}>();
	const evalNameArg = program.args[0];

	// Parse context value (may involve async file loading)
	const parsedContext = await parseContextValue(opts.context, evalNameArg);

	// Get available eval directories for prompts
	const availableEvals = await fs.readdir(EVALS_DIR, { withFileTypes: true });
	const evalOptions = availableEvals
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => ({
			value: dirent.name,
			label: dirent.name,
		}));

	// Prompt for eval name if not provided
	const evalName =
		evalNameArg ??
		(
			await p.select({
				message: 'Which eval do you want to run?',
				options: evalOptions,
			})
		).toString();

	if (p.isCancel(evalName)) {
		p.cancel('Operation cancelled.');
		process.exit(0);
	}

	// Prompt for missing arguments
	const promptResults = await p.group(
		{
			agent: async () => {
				if (opts.agent) {
					return opts.agent;
				}

				const result = await p.select({
					message: 'Which coding agent do you want to use?',
					options: [{ value: 'claude-code', label: 'Claude Code CLI' }],
				});

				if (p.isCancel(result)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}

				return result;
			},
			context: async function (): Promise<Context> {
				const evalPath = path.resolve(path.join('evals', evalName));

				// If context was already parsed from CLI, use it
				if (parsedContext !== undefined) {
					// For components-manifest, we need to convert the manifestPath to full mcpServerConfig
					if (parsedContext.type === 'components-manifest') {
						return {
							type: 'components-manifest',
							mcpServerConfig: manifestPathToMcpServerConfig(
								path.join(evalPath, parsedContext.manifestPath),
							),
						};
					}
					return parsedContext;
				}

				// Discover available files for context options
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

				if (p.isCancel(mainSelection)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}

				switch (mainSelection) {
					case false: {
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

						return { type: mainSelection, prompts: selectedExtraPromptNames };
					}
				}

				throw new Error('Unreachable context selection');
			},
			uploadId: async () => {
				// --no-upload-id explicitly disables upload
				if (opts.uploadId === false) {
					return false;
				}

				// --upload-id <id> uses that value
				if (typeof opts.uploadId === 'string') {
					return opts.uploadId;
				}

				// No flag specified, prompt the user
				const result = await p.text({
					message:
						'Enter an Upload ID to upload results to Google Sheet (leave blank to skip):',
					placeholder: 'experiment-batch-1',
				});
				if (p.isCancel(result)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}

				return result || false;
			},
			storybook: async () => parseBooleanEnv(opts.storybook, 'STORYBOOK'),
			verbose: async () => parseBooleanEnv(opts.verbose, 'VERBOSE'),
		},
		{
			onCancel: () => {
				p.cancel('Operation cancelled.');
				process.exit(0);
			},
		},
	);

	const result: CollectedArgs = {
		...promptResults,
		eval: evalName,
	};

	p.log.message([
		'To re-run this experiment, call:',
		buildRerunCommand(result),
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
