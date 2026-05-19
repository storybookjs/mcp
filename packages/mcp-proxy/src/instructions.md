## Routing

Every tool call requires a `cwd` argument: the absolute path of the Storybook project the call targets. It must exactly match the cwd from which `storybook dev` was started — there is no prefix matching or fallback.

If no Storybook is registered at that cwd, the call returns a repair message (and, when other Storybooks are running, lists their cwds as candidates) instead of proxying.

## Workflow

1. Call **list-all-documentation** once at the start of the task to discover available component and docs IDs.
2. Call **get-documentation** with an `id` from that list to retrieve full component docs, props, usage examples, and stories.
3. Call **get-documentation-for-story** when you need additional docs from a specific story variant that was not included in the initial component documentation.

Use `withStoryIds: true` on **list-all-documentation** when you also need story IDs for inputs to other tools.

## Verification Rules

- Never assume component props, variants, or API shape. Retrieve documentation before using a component.
- If a component or prop is not documented, do not invent it. Report that it was not found.
- Only reference IDs returned by **list-all-documentation**. Do not guess IDs.

## Multi-Source Requests

- When the downstream Storybook composes multiple sources, **list-all-documentation** returns entries from all of them.
- Use `storybookId` in **get-documentation** when you need to scope a request to one source.
