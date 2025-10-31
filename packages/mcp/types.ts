import * as v from 'valibot';

/**
 * Custom context passed to MCP server and tools.
 * Contains the source URL for fetching component manifests.
 */
export interface StorybookContext extends Record<string, unknown> {
	/**
	 * The URL of the remote manifest to fetch component data from.
	 */
	source?: string;
}

const JSDocTag = v.object({
	key: v.string(),
	value: v.union([v.string(), v.number(), v.boolean(), v.null()]),
});

const BaseManifest = v.object({
	name: v.string(),
	description: v.exactOptional(v.string()),
	import: v.exactOptional(v.string()),
	jsDocTags: v.exactOptional(v.array(JSDocTag)),
});

const Example = v.object({
	...BaseManifest.entries,
	snippet: v.optional(v.string()),
});

export const ComponentManifest = v.object({
	...BaseManifest.entries,
	id: v.string(),
	summary: v.exactOptional(v.string()),
	examples: v.exactOptional(v.array(Example)),
	props: v.exactOptional(v.any()),
});
export type ComponentManifest = v.InferOutput<typeof ComponentManifest>;

export const ComponentManifestMap = v.object({
	v: v.number(),
	components: v.record(v.string(), ComponentManifest),
});
export type ComponentManifestMap = v.InferOutput<typeof ComponentManifestMap>;
