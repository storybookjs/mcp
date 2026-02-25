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

| Metric                                                           | Weight |
| ---------------------------------------------------------------- | ------ |
| MCP tools coverage (`list-all-documentation`, `preview-stories`) | 40 %   |
| Discovery strategy (`withStoryIds: true`)                        | 30 %   |
| Preview input strategy (`storyId` preferred)                     | 30 %   |

## Expected MCP Tools

- `list-all-documentation` with `withStoryIds: true`
- `preview-stories`

For strategy quality credit, at least one preview invocation should pass story references via `storyId`, not only `absoluteStoryPath` + `exportName`.
