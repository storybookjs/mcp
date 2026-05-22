## Routing

Every tool call requires a `cwd` argument: the absolute path of the Storybook project the call targets. It must exactly match the cwd from which `storybook dev` was started — there is no prefix matching or fallback.

If no Storybook is registered at that cwd, the call returns a repair message (and, when other Storybooks are running, lists their cwds as candidates) instead of proxying.

## Workflow

1. Call **list-all-documentation** once at the start of the task to discover available component and docs IDs.
2. Call **get-documentation** with an `id` from that list to retrieve full component docs, props, usage examples, and stories.
3. Call **get-documentation-for-story** when you need additional docs from a specific story variant that was not included in the initial component documentation.

Use `withStoryIds: true` on **list-all-documentation** when you also need story IDs for inputs to other tools.

## Previewing Stories

- Call **preview-stories** to get Storybook preview URLs for one or more stories. Prefer `{ storyId }` inputs when you already have story IDs; use `{ absoluteStoryPath, exportName }` only when you are already working inside a specific `.stories.*` file.
- Always include each returned preview URL in your final user-facing response so users can open them directly.

## Working on Stories

- Call **get-storybook-story-instructions** before creating, updating, or editing any story file (`.stories.tsx`, `.stories.ts`, `.stories.jsx`, `.stories.js`, `.stories.svelte`, `.stories.vue`). It returns framework-specific imports, naming conventions, play functions, mocking, and test/a11y guidance.
- Call **get-changed-stories** to retrieve metadata for stories marked as new, modified, or related. It returns metadata only — pair it with **preview-stories** when URLs are needed.
- Call **run-story-tests** to execute story tests. Pass a focused `stories` list while iterating for faster feedback, or omit it to run the full suite for comprehensive verification. Accessibility checks run by default when the Storybook has addon-a11y enabled; disable with `a11y: false` if you only need component test results.

## Verification Rules

- Never assume component props, variants, or API shape. Retrieve documentation before using a component.
- If a component or prop is not documented, do not invent it. Report that it was not found.
- Only reference IDs returned by **list-all-documentation**. Do not guess IDs.

## Multi-Source Requests

- When the downstream Storybook composes multiple sources, **list-all-documentation** returns entries from all of them.
- Use `storybookId` in **get-documentation** when you need to scope a request to one source.
- If a composed Storybook source says it requires authentication, use the MCP endpoint shown for that source instead of trying to access that source through this proxy.
