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

| Metric                                                                                                                      | Weight |
| --------------------------------------------------------------------------------------------------------------------------- | ------ |
| MCP tools coverage, including docs-first discovery via `list-all-documentation` with `withStoryIds: true` and `preview-stories` | 70 %   |
| Preview input strategy (`storyId` preferred over `absoluteStoryPath` + `exportName`)                                       | 30 %   |

## Expected MCP Tools

- `list-all-documentation` with `withStoryIds: true`
- `preview-stories`

For strategy quality credit, at least one preview invocation should pass story references via `storyId`, not only `absoluteStoryPath` + `exportName`.
