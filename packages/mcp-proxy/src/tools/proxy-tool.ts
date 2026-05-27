import * as path from 'node:path';
import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import { readRegistry, type RegistryError } from '../utils/registry.ts';
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

			// read the registry and resolve the target instance based on the input cwd;
			// compatibility has already been validated by the Storybook version check above
			const { records, errors } = await readRegistry(registryDir);
			const resolution = resolveInstance(records, cwd);

			const localAnomalies = anomaliesAtCwd(errors, cwd);

			const withWarning = (result: ProxyToolCallResult): ProxyToolCallResult =>
				localAnomalies.length > 0
					? prependIncompatibleRegistryWarning(result, cwd, localAnomalies)
					: result;

			if (resolution.kind === 'intercept') {
				return withWarning(intercept(resolution.reason, { records: resolution.records }));
			}

			try {
				return withWarning(
					await proxyToolCall(resolution.record, {
						name: tool.name,
						arguments: upstreamArgs,
					}),
				);
			} catch (error) {
				return withWarning({
					content: [
						{
							type: 'text',
							text: `Failed to reach Storybook MCP at ${resolution.record.mcp.endpoint ?? '(no endpoint)'}: ${
								error instanceof Error ? error.message : String(error)
							}`,
						},
					],
					isError: true,
				});
			}
		},
	);
}

function anomaliesAtCwd(anomalies: RegistryError[], targetCwd: string): RegistryError[] {
	const normalized = path.resolve(targetCwd);
	return anomalies.filter((a) => {
		try {
			return path.resolve(a.cwd) === normalized;
		} catch {
			return false;
		}
	});
}

function formatIncompatibleRegistryWarning(
	targetCwd: string,
	anomalies: RegistryError[],
): string {
	const unsupportedVersions = [
		...new Set(
			anomalies
				.filter(
					(a): a is Extract<RegistryError, { kind: 'unsupported-schema' }> =>
						a.kind === 'unsupported-schema',
				)
				.map((a) => a.schemaVersion),
		),
	].sort((a, b) => a - b);
	const unparseableCount = anomalies.filter((a) => a.kind === 'unparseable').length;

	const parts: string[] = [];
	if (unsupportedVersions.length > 0) {
		const list = unsupportedVersions.map((n) => `\`v${n}\``).join(', ');
		const plural = unsupportedVersions.length === 1 ? 'schema version' : 'schema versions';
		parts.push(`${plural} ${list} (newer than this proxy supports)`);
	}
	if (unparseableCount > 0) {
		const plural = unparseableCount === 1 ? 'record file' : 'record files';
		parts.push(`${unparseableCount} ${plural} this proxy could not parse`);
	}
	return `> Note: The Storybook instance registry has record(s) at \`${targetCwd}\` that this MCP proxy cannot interpret: ${parts.join(' and ')}. The user's Storybook at that cwd is likely newer than the proxy or writing a format the proxy does not yet recognise. Tell the user to upgrade \`@storybook/mcp-proxy\` so the proxy can recognise that Storybook instance. The current call was handled using only the records this proxy could parse.`;
}

function prependIncompatibleRegistryWarning(
	result: ProxyToolCallResult,
	targetCwd: string,
	anomalies: RegistryError[],
): ProxyToolCallResult {
	return {
		...result,
		content: [
			{ type: 'text', text: formatIncompatibleRegistryWarning(targetCwd, anomalies) },
			...(result.content ?? []),
		],
	};
}
