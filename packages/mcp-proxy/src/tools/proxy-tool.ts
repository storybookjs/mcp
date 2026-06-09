import * as path from 'node:path';
import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import { readRegistry } from '../utils/registry.ts';
import { proxyToolCall } from '../utils/proxy-client.ts';
import { resolveInstance } from '../utils/resolve-instance.ts';
import { checkStorybookVersion } from '../utils/version-check.ts';
import { intercept } from './intercepts.ts';
import type { ProxyToolCallResult, StorybookInstanceRecordV1 } from '../types/index.ts';

function formatMultiInstanceWarning(
	chosen: StorybookInstanceRecordV1,
	siblings: StorybookInstanceRecordV1[],
): string {
	const all = [chosen, ...siblings];
	const lines = all.map((r) => {
		const marker = r === chosen ? ' (proxied)' : '';
		return `> - pid \`${r.pid}\` at ${r.url} (mcp: \`${r.mcp.status}\`)${marker}`;
	});
	return `> Warning: Multiple Storybook instances are running at this cwd. This call was proxied to pid \`${chosen.pid}\`.
>
> Instances at \`${chosen.cwd}\`:
${lines.join('\n')}
>
> If results look unexpected, ask the user whether they want to stop the other instance(s).`;
}

function prependMultiInstanceWarning(
	result: ProxyToolCallResult,
	chosen: StorybookInstanceRecordV1,
	siblings: StorybookInstanceRecordV1[],
): ProxyToolCallResult {
	const warning = formatMultiInstanceWarning(chosen, siblings);
	return {
		...result,
		content: [{ type: 'text', text: warning }, ...(result.content ?? [])],
	};
}

const CwdField = {
	cwd: v.pipe(
		v.string(),
		v.description(
			'Absolute path of the Storybook project this call targets. Required — must exactly match the cwd from which `storybook dev` was started.',
		),
	),
	port: v.optional(
		v.pipe(
			v.number(),
			v.integer(),
			v.minValue(1),
			v.maxValue(65535),
			v.description(
				'Optional. The port the target Storybook is running on. Supply it to address one specific instance when several share the same `cwd`, or when an ADE (e.g. Claude Desktop) launched Storybook on a port it knows. When set, the instance must match BOTH `cwd` and this port; omit it to route by `cwd` alone — when several instances share that `cwd`, the most recently started one is used.',
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
		async (
			input: Record<string, unknown> & { cwd: string; port?: number },
		): Promise<ProxyToolCallResult> => {
			const { cwd, port, ...upstreamArgs } = input;

			if (!path.isAbsolute(cwd)) {
				return intercept('invalid-cwd');
			}

			// first check the Storybook version before hitting the registry or doing instance resolution, to fail fast if the version is too old
			const versionStatus = checkStorybookVersion(cwd);
			if (versionStatus.status === 'too-old') {
				return intercept('storybook-too-old', { version: versionStatus.version });
			}

			// read the registry and resolve the target instance based on the input cwd;
			// compatibility has already been validated by the Storybook version check above
			const records = await readRegistry(registryDir);
			const resolution = resolveInstance(records, cwd, port);

			if (resolution.kind === 'intercept') {
				if (
					resolution.reason === 'no-instance' &&
					versionStatus.status === 'not-installed' &&
					(resolution.records?.length ?? 0) === 0
				) {
					return intercept('storybook-not-installed');
				}
				return intercept(resolution.reason, { records: resolution.records, port });
			}

			try {
				const result = await proxyToolCall(resolution.record, {
					name: tool.name,
					arguments: upstreamArgs,
				});
				const siblings = resolution.matches.filter((r) => r !== resolution.record);
				if (siblings.length > 0) {
					return prependMultiInstanceWarning(result, resolution.record, siblings);
				}
				return result;
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
