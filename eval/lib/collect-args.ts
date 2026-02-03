import { Command, Option } from '@commander-js/extra-typings';
import * as p from '@clack/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as v from 'valibot';
import { randomUUID } from 'node:crypto';
import {
	McpServerConfigSchema,
	SUPPORTED_MODELS,
	CLAUDE_MODELS,
	COPILOT_MODELS,
	type Context,
	type McpServerConfig,
	type SupportedModel,
} from '../types.ts';
import { agents } from '../config.ts';

export type CollectedArgs = {
	agent: keyof typeof agents;
	model: SupportedModel;
	verbose: boolean;
	taskName: string;
	context: Context;
	systemPrompts: string[];
	storybook: boolean | undefined;
	uploadId: string | false;
	runId: string;
	label?: string;
};

/**
 * Parses a boolean value from a CLI flag or environment variable.
 *
 * If the CLI value is provided (not undefined), it is returned directly.
 * Otherwise, the environment variable with the given name is checked:
 *   - Returns true for "true", "1", "yes" (case-insensitive).
 *   - Returns false for "false", "0", "no" (case-insensitive).
 *   - Returns undefined if the environment variable is unset or set to an unrecognized value.
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
 */
type ParsedContext =
	| { type: false }
	| { type: 'extra-prompts'; prompts: string[] }
	| { type: 'mcp-server'; mcpServerConfig: McpServerConfig }
	| { type: 'storybook-mcp-docs' }
	| { type: 'storybook-mcp-dev' };

/**
 * Parse a single context string value into a ParsedContext object.
 */
async function parseSingleContextValue(
	rawContext: string,
	taskName: string | undefined,
): Promise<ParsedContext> {
	const TASKS_DIR = path.join(process.cwd(), 'tasks');

	// Try to parse as JSON (inline MCP config)
	try {
		const parsed = JSON.parse(rawContext);
		const validated = v.parse(McpServerConfigSchema, parsed);
		return { type: 'mcp-server', mcpServerConfig: validated };
	} catch {
		// Not valid JSON, continue with other patterns
	}

	// Storybook MCP dev mode (--context=storybook-dev)
	if (rawContext === 'storybook-dev') {
		return { type: 'storybook-mcp-dev' };
	}

	// Components manifest file (--context=storybook-docs)
	if (rawContext === 'storybook-docs') {
		return { type: 'storybook-mcp-docs' };
	}

	// MCP config file (ends with .json)
	if (rawContext.endsWith('.json')) {
		if (!taskName) {
			throw new Error(
				'To set an MCP config file as the context, you must also set the task as a positional argument',
			);
		}
		const configPath = path.join(TASKS_DIR, taskName, rawContext);
		const { default: config } = await import(configPath, {
			with: { type: 'json' },
		});
		const validated = v.parse(McpServerConfigSchema, config);
		return { type: 'mcp-server', mcpServerConfig: validated };
	}

	// Extra prompts (ends with .md)
	if (rawContext.endsWith('.md')) {
		return { type: 'extra-prompts', prompts: [rawContext] };
	}

	throw new Error(`Unable to parse context value: ${rawContext}`);
}

/**
 * Parse a raw context string value into an array of ParsedContext objects.
 * Returns undefined if no context was provided (will trigger interactive prompt).
 */
async function parseContextValue(
	rawContext: string | boolean | undefined,
	taskName: string | undefined,
): Promise<ParsedContext[] | undefined> {
	// --no-context sets context to false
	if (rawContext === false) {
		return [{ type: false }];
	}

	// No context provided
	if (rawContext === undefined || rawContext === true) {
		return undefined;
	}

	// Handle comma-separated contexts
	const contextStrings = rawContext.split(',').map((s) => s.trim());
	const parsedContexts: ParsedContext[] = [];

	for (const contextStr of contextStrings) {
		const parsed = await parseSingleContextValue(contextStr, taskName);
		parsedContexts.push(parsed);
	}

	return parsedContexts;
}

/**
 * Build a rerun command from the final collected arguments.
 */
function buildRerunCommand(args: CollectedArgs): string {
	const parts: string[] = ['node', 'advanced-eval.ts'];

	parts.push('--agent', args.agent);
	parts.push('--model', args.model);

	if (args.verbose) {
		parts.push('--verbose');
	}

	if (args.storybook !== undefined) {
		parts.push(args.storybook ? '--storybook' : '--no-storybook');
	}

	// Handle context array
	if (args.context.length === 0) {
		parts.push('--no-context');
	} else if (args.context.length === 1 && args.context[0]!.type === false) {
		parts.push('--no-context');
	} else {
		const contextStrings: string[] = [];
		for (const context of args.context) {
			switch (context.type) {
				case false:
					// Skip false contexts when there are other contexts
					break;
				case 'mcp-server':
					contextStrings.push(`'${JSON.stringify(context.mcpServerConfig)}'`);
					break;
				case 'storybook-mcp-dev':
					contextStrings.push('storybook-dev');
					break;
				case 'storybook-mcp-docs':
					contextStrings.push('storybook-docs');
					break;
				case 'extra-prompts':
					contextStrings.push(...context.prompts);
					break;
				case 'inline-prompt':
					// Inline prompts are handled at prompt generation time, not here
					break;
			}
		}
		if (contextStrings.length > 0) {
			parts.push(`--context=${contextStrings.join(',')}`);
		}
	}

	if (args.systemPrompts.length > 0) {
		parts.push(`--system-prompts=${args.systemPrompts.join(',')}`);
	}

	if (args.uploadId) {
		parts.push(`--upload-id=${args.uploadId}`);
	} else {
		parts.push('--no-upload-id');
	}

	if (args.runId) {
		parts.push(`--run-id=${args.runId}`);
	}

	parts.push(args.taskName);

	return parts.join(' ');
}

const HELP_EXAMPLES = `
Examples:
  $ node advanced-eval.ts                                    Interactive mode (recommended)
  $ node advanced-eval.ts 100-flight-booking-plain           Run specific task
  $ node advanced-eval.ts --agent ${Object.keys(agents)[0]} --context components.json 100-flight-booking-plain
  $ node advanced-eval.ts --verbose --context extra-prompt-01.md,extra-prompt-02.md 100-flight-booking-plain
  $ node advanced-eval.ts --context mcp.config.json 110-flight-booking-reshaped
  $ node advanced-eval.ts --context storybook-dev 200-build-ui-with-storybook

Context Modes:
  None                  Agent uses only built-in tools (--no-context)
  Storybook MCP - Dev   Runs local Storybook dev server with MCP (--context storybook-dev)
  Storybook MCP - Docs  Provides component docs via @storybook/mcp (--context file.json)
  MCP Server            Custom MCP server config (--context mcp.config.json or inline JSON)
  Extra Prompts         Append markdown instructions (--context file1.md,file2.md)

Learn More: eval/README.md
`;

export async function collectArgs(): Promise<CollectedArgs> {
	const TASKS_DIR = path.join(process.cwd(), 'tasks');

	// Load .env file - CLI args will override these
	try {
		process.loadEnvFile(path.join(process.cwd(), '.env'));
	} catch {
		// File doesn't exist or can't be read - that's fine, env vars are optional
	}

	// Configure Commander program
	const program = new Command()
		.name('advanced-eval.ts')
		.description(
			'A CLI tool for testing AI coding agents with Storybook and MCP tools.',
		)
		.argument('[task-name]', 'Name of the task directory in tasks/')
		.addOption(
			new Option('-a, --agent <name>', 'Which coding agent to use')
				.choices(Object.keys(agents))
				.env('AGENT')
				.argParser((value) => value as keyof typeof agents),
		)
		.addOption(
			new Option('-m, --model <name>', 'Which model to use for the agent')
				.choices([...SUPPORTED_MODELS])
				.env('MODEL')
				.argParser((value) => value as SupportedModel),
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
				'Auto-start Storybook after grading (env: STORYBOOK)',
			),
		)
		.addOption(
			new Option(
				'--no-storybook',
				'Do not auto-start Storybook after grading (env: STORYBOOK)',
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
				'--system-prompts <files>',
				'System prompt files to merge into Claude.md (comma-separated, e.g., system.base.md,system.strict.md)',
			).env('SYSTEM_PROMPTS'),
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
		.addOption(
			new Option(
				'--run-id <id>',
				'Run identifier to group uploads together (env: RUN_ID)',
			).env('RUN_ID'),
		)
		.addOption(
			new Option(
				'--label <label>',
				'Human-readable label for this run',
			).hideHelp(),
		)
		.addHelpText('after', HELP_EXAMPLES);

	await program.parseAsync();

	const opts = program.opts();
	const taskNameArg = program.args[0];

	// Parse context value (may involve async file loading)
	const parsedContext = await parseContextValue(opts.context, taskNameArg);

	// Get available task directories for prompts
	const availableTasks = await fs.readdir(TASKS_DIR, { withFileTypes: true });
	const taskOptions = availableTasks
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => ({
			value: dirent.name,
			label: dirent.name,
		}));

	// Prompt for task name if not provided
	const taskName =
		taskNameArg ??
		(
			await p.select({
				message: 'Which task do you want to run?',
				options: taskOptions,
			})
		).toString();

	if (p.isCancel(taskName)) {
		p.cancel('Operation cancelled.');
		process.exit(0);
	}

	const taskPath = path.resolve(path.join('tasks', taskName));
	const promptPath = path.join(taskPath, 'prompt.md');
	let promptIsEmpty = false;
	try {
		const promptContent = await fs.readFile(promptPath, 'utf8');
		promptIsEmpty = promptContent.trim().length === 0;
	} catch {
		promptIsEmpty = true;
	}

	// Prompt for missing arguments
	const promptResults = await p.group(
		{
			agent: async () => {
				if (opts.agent) {
					return opts.agent;
				}

				const result = await p.select<keyof typeof agents>({
					message: 'Which coding agent do you want to use?',
					options: [
						{ value: 'claude-code', label: 'Claude Code CLI' },
						{ value: 'copilot-cli', label: 'GitHub Copilot CLI' },
					],
				});

				if (p.isCancel(result)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}

				return result;
			},
			model: async ({ results }): Promise<SupportedModel> => {
				// Determine available models based on selected agent
				const selectedAgent = results.agent;
				const availableModels: readonly SupportedModel[] =
					selectedAgent === 'claude-code' ? CLAUDE_MODELS : COPILOT_MODELS;

				if (opts.model) {
					// Validate that the provided model is valid for the selected agent
					if (!availableModels.includes(opts.model)) {
						throw new Error(
							`Model "${opts.model}" is not supported by ${selectedAgent}. Available models: ${availableModels.join(', ')}`,
						);
					}
					return opts.model;
				}

				const result = await p.select<SupportedModel>({
					message: 'Which model should the agent use?',
					options: availableModels.map((model) => ({
						value: model,
						label: model,
					})),
				});

				if (p.isCancel(result)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}

				return result;
			},
			context: async function (): Promise<Context> {
				const taskDir = path.resolve(path.join('tasks', taskName));

				if (parsedContext !== undefined) {
					return parsedContext;
				}

				// Discover available files for context options
				const availableExtraPrompts: Record<string, string> = {};
				const availableSystemPrompts: Record<string, string> = {};
				let availableManifest: string[] | undefined = undefined;
				for (const dirent of await fs.readdir(taskDir, {
					withFileTypes: true,
				})) {
					if (!dirent.isFile()) {
						continue;
					}
					if (dirent.name === 'components.json') {
						const { default: manifestContent } = await import(
							path.join(taskDir, dirent.name),
							{
								with: { type: 'json' },
							}
						);
						availableManifest = Object.keys(manifestContent.components || {});
					} else if (
						dirent.name.startsWith('system.') &&
						dirent.name.endsWith('.md')
					) {
						const content = await fs.readFile(
							path.join(taskDir, dirent.name),
							'utf8',
						);
						availableSystemPrompts[dirent.name] = content;
					} else if (
						dirent.name.endsWith('.md') &&
						dirent.name !== 'prompt.md' &&
						!dirent.name.startsWith('system.')
					) {
						const content = await fs.readFile(
							path.join(taskDir, dirent.name),
							'utf8',
						);
						availableExtraPrompts[dirent.name] = content;
					}
				}

				if (promptIsEmpty && Object.keys(availableExtraPrompts).length === 0) {
					throw new Error(
						`prompt.md is empty for task "${taskName}" and no extra prompts were found. Add at least one extra prompt .md file to this task directory.`,
					);
				}

				const selectedContextTypes = await p.multiselect<string>({
					message:
						'Which additional contexts should the agent have? (select multiple)',
					options: [
						{
							label: 'Storybook MCP - Dev',
							hint: 'Run local Storybook dev server with MCP endpoint',
							value: 'storybook-mcp-dev',
						},
						{
							label: 'Storybook MCP - Docs',
							hint:
								availableManifest && availableManifest.length > 0
									? 'Add a Storybook MCP server based on manifest files'
									: 'No manifest files available for this task',
							value: 'storybook-mcp-docs',
							disabled: !availableManifest || availableManifest.length === 0,
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
									? 'Include any of the additional prompts from the task'
									: 'No additional prompts available for this task',
							value: 'extra-prompts',
							disabled: Object.keys(availableExtraPrompts).length === 0,
						},
					],
				});

				if (p.isCancel(selectedContextTypes)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}

				if (
					promptIsEmpty &&
					!selectedContextTypes.includes('extra-prompts') &&
					Object.keys(availableExtraPrompts).length > 0
				) {
					selectedContextTypes.push('extra-prompts');
				}

				// If nothing selected, return array with false
				if (selectedContextTypes.length === 0) {
					return [{ type: false }];
				}

				const contexts: Context = [];

				for (const contextType of selectedContextTypes) {
					switch (contextType) {
						case 'storybook-mcp-dev': {
							contexts.push({ type: 'storybook-mcp-dev' });
							break;
						}
						case 'storybook-mcp-docs': {
							contexts.push({
								type: 'storybook-mcp-docs',
							});
							break;
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
								contexts.push({
									type: 'mcp-server',
									mcpServerConfig: config,
								});
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
								contexts.push({
									type: 'mcp-server',
									mcpServerConfig: config,
								});
							}
							break;
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

							if (promptIsEmpty && selectedExtraPromptNames.length === 0) {
								throw new Error(
									`prompt.md is empty for task "${taskName}". You must select at least one extra prompt.`,
								);
							}

							contexts.push({
								type: 'extra-prompts',
								prompts: selectedExtraPromptNames,
							});
							break;
						}
					}
				}

				return contexts;
			},
			systemPrompts: async () => {
				// If system prompts were provided via CLI, use them
				if (opts.systemPrompts) {
					return opts.systemPrompts.split(',').map((s: string) => s.trim());
				}

				// Discover system.*.md files if not already discovered
				const availableSystemPrompts: Record<string, string> = {};
				for (const dirent of await fs.readdir(taskPath, {
					withFileTypes: true,
				})) {
					if (
						dirent.isFile() &&
						dirent.name.startsWith('system.') &&
						dirent.name.endsWith('.md')
					) {
						const content = await fs.readFile(
							path.join(taskPath, dirent.name),
							'utf8',
						);
						availableSystemPrompts[dirent.name] = content;
					}
				}

				// If no system prompts found, return empty array
				if (Object.keys(availableSystemPrompts).length === 0) {
					return [];
				}

				const systemPromptOptions = Object.entries(availableSystemPrompts).map(
					([name, content]) => ({
						label: name,
						hint:
							content.slice(0, 100).replace(/\n/g, ' ') +
							(content.length > 100 ? '...' : ''),
						value: name,
					}),
				);

				const selectedSystemPromptNames = await p.multiselect({
					message:
						'Which system prompts should be included? (will be merged into Claude.md)',
					options: systemPromptOptions,
					required: false,
				});

				if (p.isCancel(selectedSystemPromptNames)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}

				return selectedSystemPromptNames ?? [];
			},
			uploadId: async () => {
				if (opts.uploadId !== undefined) {
					return opts.uploadId;
				}

				// No flag specified, prompt the user
				const result = await p.text({
					message:
						'Enter an Upload ID to upload results to Google Sheet (leave blank to skip):',
					placeholder: 'trial-batch-1',
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

	const runId = opts.runId ?? randomUUID();

	const result: CollectedArgs = {
		agent: promptResults.agent,
		model: promptResults.model as SupportedModel,
		context: promptResults.context as Context,
		systemPrompts: promptResults.systemPrompts as string[],
		uploadId: promptResults.uploadId,
		storybook: promptResults.storybook,
		verbose: promptResults.verbose,
		taskName,
		runId,
		label: opts.label,
	};

	p.log.message(['To re-run this trial, call:', buildRerunCommand(result)]);

	return result;
}
