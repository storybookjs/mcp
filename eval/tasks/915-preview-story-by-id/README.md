# 915 – Preview Existing Stories by ID

## Purpose

Tests whether the agent chooses the **docs-first ID flow** when no story file context is provided.

## Setup

- Pre-seeded Button component and Primary/Secondary stories.
- Prompt asks only for previews of existing stories.
- No file edits are expected.

## Prompt

Asks the agent to preview two existing stories: Button Primary and Secondary.

## Quality Signal

| Metric                                       | Weight |
| -------------------------------------------- | ------ |
| Preview input strategy (`storyId` preferred) | 50 %   |
| Final response includes both preview URLs    | 40 %   |

## Expected MCP Tools

- `list-all-documentation` with `withStoryIds: true`
- `preview-stories`

For strategy quality credit, at least one preview invocation should pass story references via `storyId`, not only `absoluteStoryPath` + `exportName`.

For final-response quality credit, the final assistant response should include preview URLs for both `example-button--primary` and `example-button--secondary`.

`list-all-documentation` with `withStoryIds: true` remains part of MCP tool expectation/coverage, but it is not part of the custom hook quality formula for this task.
