import * as path from 'node:path';
import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import { readRegistry } from '../utils/registry.ts';
import { proxyToolCall } from '../utils/proxy-client.ts';
import { resolveInstance } from '../utils/resolve-instance.ts';
import { checkStorybookVersion } from '../utils/version-check.ts';
import { intercept } from './intercepts.ts';
import type { ProxyToolCallResult } from '../types/index.ts';

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
	registryDir: string,
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
		async (input: Record<string, unknown> & { cwd: string }): Promise<ProxyToolCallResult> => {
			const { cwd, ...upstreamArgs } = input;

			if (!path.isAbsolute(cwd)) {
				return intercept('invalid-cwd');
			}

			// first check the Storybook version before hitting the registry or doing instance resolution, to fail fast if the version is too old
			const versionStatus = checkStorybookVersion(cwd);
			if (versionStatus.status === 'too-old') {
				return intercept('storybook-too-old', { version: versionStatus.version });
			}

			// read the registry and resolve the target instance based on the input cwd
			// only works with sb > 10.5
			const records = await readRegistry(registryDir);
			const resolution = resolveInstance(records, cwd);

			if (resolution.kind === 'intercept') {
				return intercept(resolution.reason, { records: resolution.records });
			}

			try {
				return await proxyToolCall(resolution.record, {
					name: tool.name,
					arguments: upstreamArgs,
				});
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Failed to reach Storybook MCP at ${resolution.record.mcp.endpoint ?? '(no endpoint)'}: ${
								error instanceof Error ? error.message : String(error)
							}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
