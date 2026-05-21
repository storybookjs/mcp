import * as v from 'valibot';

export const McpStatusV1Schema = v.picklist(['not-installed', 'starting', 'ready', 'error']);
export type McpStatusV1 = v.InferOutput<typeof McpStatusV1Schema>;

/**
 * Schema of a single Storybook runtime record written under the registry dir
 * (default `~/.storybook/instances`). One file per running `storybook dev`
 * instance. Spec: storybookjs/storybook#34826.
 */
export const StorybookInstanceRecordV1Schema = v.object({
	schemaVersion: v.literal(1),
	instanceId: v.string(),
	pid: v.pipe(v.number(), v.integer(), v.minValue(1)),
	cwd: v.string(),
	url: v.string(),
	port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
	storybookVersion: v.optional(v.string()),
	startedAt: v.optional(v.string()),
	updatedAt: v.optional(v.string()),
	mcp: v.object({
		status: McpStatusV1Schema,
		endpoint: v.optional(v.string()),
	}),
});
export type StorybookInstanceRecordV1 = v.InferOutput<typeof StorybookInstanceRecordV1Schema>;
