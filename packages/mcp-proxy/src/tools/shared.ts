import * as v from 'valibot';

/**
 * Schemas duplicated from `@storybook/mcp` and `@storybook/addon-mcp` so the
 * proxy can advertise the full tool surface without a runtime dependency on a
 * running Storybook. Keep these in lockstep with the originals — both packages
 * are released together. Source files:
 *  - packages/mcp/src/types.ts (StorybookIdField)
 *  - packages/addon-mcp/src/types.ts (StoryInput, StoryInputArray)
 */

const StoryInputProps = {
	props: v.optional(
		v.pipe(
			v.record(v.string(), v.any()),
			v.description(
				'Optional custom props to pass to the story for rendering. Use this when you want to customize args without rendering the default story.',
			),
		),
	),
	globals: v.optional(
		v.pipe(
			v.record(v.string(), v.any()),
			v.description(
				'Optional Storybook globals to set for the story preview (e.g. theme, locale, viewport).',
			),
		),
	),
};

export const StoryInput = v.union([
	v.object({
		exportName: v.pipe(
			v.string(),
			v.description(
				'The export name of the story from the story file. Use this shape only when you are already editing a .stories.* file and know the export names; otherwise prefer the storyId shape.',
			),
		),
		explicitStoryName: v.optional(
			v.pipe(
				v.string(),
				v.description(
					'If the story has an explicit name set via the "name" property that differs from the export name, provide it here.',
				),
			),
		),
		absoluteStoryPath: v.pipe(
			v.string(),
			v.description(
				'Absolute path to the story file. Use together with exportName only when story-file context is already available.',
			),
		),
		...StoryInputProps,
	}),
	v.object({
		storyId: v.pipe(
			v.string(),
			v.description(
				'Full Storybook story ID (for example "button--primary"). Prefer this shape whenever you are not already working in a specific story file.',
			),
		),
		...StoryInputProps,
	}),
]);

export const StoryInputArray = v.array(StoryInput);

export const StorybookIdField = {
	storybookId: v.optional(
		v.pipe(
			v.string(),
			v.description(
				'Storybook source ID (e.g. "local", "tetra"). Required when the downstream Storybook is composed from multiple sources. See list-all-documentation for available sources.',
			),
		),
	),
};
