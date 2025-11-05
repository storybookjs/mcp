import { parseArgs } from 'node:util';
import * as v from 'valibot';
import * as p from '@clack/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { McpServerConfigSchema, type Context } from '../types.ts';

export async function collectArgs() {
	const ArgsSchema = v.pipeAsync(
		v.objectAsync({
			values: v.objectAsync({
				agent: v.optional(
					v.union([v.literal('claude-code'), v.literal('copilot')]),
				),
				verbose: v.boolean(),
				context: v.optionalAsync(
					v.unionAsync([
						v.pipe(
							v.literal(false),
							v.transform(() => ({ type: false as const })),
						),
						// the context can be a path to a .json mcp server config
						v.pipeAsync(
							v.string(),
							v.startsWith('.'),
							v.endsWith('.json'),
							v.transformAsync(
								async (filePath) =>
									(await import(filePath, { with: { type: 'json' } })).default,
							),
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
						// ... or one or more extra prompts from the eval root
						v.pipeAsync(
							v.array(v.pipe(v.string(), v.endsWith('.md'))),
							v.transformAsync(async (filePaths) => {
								const contents = await Promise.all(
									filePaths.map(
										async (filePath) => await fs.readFile(filePath, 'utf8'),
									),
								);
								return {
									type: 'extra-prompts' as const,
									contents,
								};
							}),
						),
					]),
				),
			}),
			positionals: v.optional(v.array(v.string())),
		}),
		v.transform(({ values, positionals }) => ({
			...values,
			eval: positionals?.[0],
		})),
	);

	const nodeParsedArgs = parseArgs({
		options: {
			agent: { type: 'string', short: 'a' },
			verbose: { type: 'boolean', default: false, short: 'v' },
			context: { type: 'string', short: 'c' },
		},
		strict: false,
		allowPositionals: true,
		allowNegative: true,
	});

	const parsedArgs = await v.parseAsync(ArgsSchema, nodeParsedArgs);

	// Get available eval directories
	const evalsDir = path.join(process.cwd(), 'evals');
	const availableEvals = await fs.readdir(evalsDir, { withFileTypes: true });
	const evalOptions = availableEvals
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => ({
			value: dirent.name,
			label: dirent.name,
		}));

	const evalPromptResult =
		parsedArgs.eval ??
		(
			await p.select({
				message: 'Which eval do you want to run?',
				options: evalOptions,
			})
		).toString();

	// Prompt for missing arguments
	const promptResults = await p.group(
		{
			agent: async () => {
				if (parsedArgs.agent) {
					return parsedArgs.agent;
				}

				const result = await p.select({
					message: 'Which coding agents do you want to use?',
					options: [{ value: 'claude-code', label: 'Claude Code CLI' }],
				});

				if (p.isCancel(result)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}

				return result;
			},
			context: async function (): Promise<Context> {
				if (parsedArgs.context !== undefined) {
					return parsedArgs.context;
				}
				const evalPath = path.resolve(path.join('evals', evalPromptResult));
				const extraPromptNames = (
					await fs.readdir(evalPath, {
						withFileTypes: true,
					})
				)
					.filter(
						(dirent) =>
							dirent.isFile() &&
							dirent.name.endsWith('.md') &&
							dirent.name !== 'prompt.md',
					)
					.map((dirent) => dirent.name);

				const mainSelection = await p.select<false | string>({
					message: 'Which additional context should the agent have?',
					options: [
						{
							label: 'None',
							hint: 'No additional context beyond the prompt and default tools',
							value: false,
						},
						{
							label: 'MCP server',
							hint: 'Add an MCP server to the agent',
							value: 'mcp-server',
						},
						{
							label: 'Extra prompts',
							hint:
								extraPromptNames.length > 0
									? 'Include any of the additional prompts from the eval'
									: 'No additional prompts available for this eval',
							value: 'extra-prompts',
							disabled: extraPromptNames.length === 0,
						},
					],
				});

				switch (mainSelection) {
					case false: {
						return { type: false };
					}
					case 'extra-prompts': {
						const promptContents = [];
						for (const promptName of extraPromptNames) {
							const content = await fs.readFile(
								path.join(evalPath, promptName),
								'utf8',
							);
							promptContents.push(content);
						}

						const extraPromptOptions = promptContents.map((content, index) => ({
							label: extraPromptNames[index],
							hint:
								content.slice(0, 100).replace(/\n/g, ' ') +
								(content.length > 100 ? '...' : ''),
							value: content,
						}));
						const extraPrompts = await p.multiselect({
							message: 'Which extra prompts should be included as context?',
							options: extraPromptOptions,
						});
						if (p.isCancel(extraPrompts)) {
							p.cancel('Operation cancelled.');
							process.exit(0);
						}
						return { type: mainSelection, contents: extraPrompts };
					}
					case 'mcp-server': {
						const mcpServerName = await p.text({
							message:
								'What name should be used for the MCP server? (storybook-mcp)',
							defaultValue: 'storybook-mcp',
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
								defaultValue: 'http://localhost:6006/mcp',
							});
							if (p.isCancel(mcpServerUrl)) {
								p.cancel('Operation cancelled.');
								process.exit(0);
							}
							return {
								type: mainSelection,
								mcpServerConfig: {
									[mcpServerName]: { type: 'http', url: mcpServerUrl },
								},
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

							return {
								type: mainSelection,
								mcpServerConfig: {
									[mcpServerName]: {
										type: 'stdio',
										command,
										args:
											argsParts.length > 0 ? argsParts.join(' ') : undefined,
									},
								},
							};
						}
					}
				}

				if (p.isCancel(mainSelection)) {
					p.cancel('Operation cancelled.');
					process.exit(0);
				}
				throw new Error('Unreachable context selection');
			},
			verbose: async () => parsedArgs.verbose,
		},
		{
			onCancel: () => {
				p.cancel('Operation cancelled.');
				process.exit(0);
			},
		},
	);

	return {
		agent: promptResults.agent,
		verbose: promptResults.verbose,
		eval: evalPromptResult,
		context: promptResults.context,
	};
}
