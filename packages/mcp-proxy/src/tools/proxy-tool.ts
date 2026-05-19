import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import { resolveInstance } from '../resolve-instance.ts';
import { intercept } from '../intercepts.ts';
import type { ProxyDeps, ProxyToolCallResult } from '../types/index.ts';

const CwdField = {
	cwd: v.pipe(
		v.string(),
		v.description(
			'Absolute path of the Storybook project this call targets. Required — must exactly match the cwd from which `storybook dev` was started.',
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
 * Storybook MCP. Every tool's input schema is the upstream tool's schema plus
 * a required `cwd` field.
 *
 * If the upstream schema is omitted, the tool accepts only `cwd`.
 */
export function registerProxyTool<Schema extends v.ObjectEntries>(
	server: McpServer<any>,
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
		async (input: Record<string, unknown> & { cwd: string }): Promise<any> => {
			const { cwd, ...upstreamArgs } = input;
			const records = await deps.readRegistry();
			const resolution = resolveInstance(records, cwd);

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
							text: `Failed to reach Storybook MCP at ${resolution.record.mcp.endpoint ?? '(no endpoint)'}: ${
								error instanceof Error ? error.message : String(error)
							}`,
						},
					],
					isError: true,
				};
			}

			return result;
		},
	);
}
