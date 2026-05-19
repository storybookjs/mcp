import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import { resolveInstance } from '../resolve-instance.ts';
import { fallbackPreamble, intercept, META_FALLBACK_INSTANCE } from '../intercepts.ts';
import type { ProxyContext, ProxyDeps, ProxyToolCallResult } from '../types.ts';

const CwdField = {
	cwd: v.optional(
		v.pipe(
			v.string(),
			v.description(
				'Absolute path of the Storybook project this call is about (the directory `storybook dev` was started from, or any path inside it). Defaults to the proxy process working directory. Pass this when the agent has a more specific path (for example the currently open file).',
			),
		),
	),
};

type ProxyToolDefinition<Schema extends v.ObjectEntries> = {
	name: string;
	title?: string;
	description: string;
	schema?: v.ObjectSchema<Schema, undefined>;
};

/**
 * Register a tool on the proxy server that forwards to the matching local
 * Storybook MCP. The tool's input schema is the upstream tool's schema plus an
 * optional `cwd` override field.
 *
 * If the schema is omitted, the tool accepts only the `cwd` override.
 */
export function registerProxyTool<Schema extends v.ObjectEntries>(
	server: McpServer<any, ProxyContext>,
	deps: ProxyDeps,
	tool: ProxyToolDefinition<Schema>,
) {
	const baseEntries = (tool.schema?.entries ?? {}) as v.ObjectEntries;
	const schema = v.object({ ...baseEntries, ...CwdField });

	server.tool(
		{
			name: tool.name,
			title: tool.title,
			description: tool.description,
			schema,
		},
		// The downstream MCP can legally return any content shape from MCP's tool-result
		// union (`text` / `image` / `audio` / `resource` / `resource_link`). We forward
		// it as-is; tmcp's generic CallToolResult type narrows to a strict union, so we
		// cast at the boundary rather than carry the union through every internal type.
		async (input: Record<string, unknown>): Promise<any> => {
			const { cwd: cwdArg, ...upstreamArgs } = input;
			const targetPath =
				typeof cwdArg === 'string' && cwdArg.length > 0
					? cwdArg
					: (server.ctx.custom?.cwd ?? deps.cwd());

			const records = await deps.readRegistry();
			const resolution = resolveInstance(records, targetPath);

			if (resolution.kind === 'intercept') {
				return intercept(resolution.reason, resolution.records);
			}

			let result: ProxyToolCallResult;
			try {
				result = await deps.proxyToolCall(resolution.record, {
					name: tool.name,
					arguments: upstreamArgs,
				});
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to reach Storybook MCP at ${resolution.record.url}${resolution.record.mcp.path}: ${
								error instanceof Error ? error.message : String(error)
							}`,
						},
					],
					isError: true,
				};
			}

			if (resolution.fallback) {
				return {
					...result,
					content: [
						{ type: 'text' as const, text: fallbackPreamble(resolution.record, targetPath) },
						...result.content,
					],
					_meta: { ...result._meta, [META_FALLBACK_INSTANCE]: resolution.record.cwd },
				};
			}

			return result;
		},
	);
}
