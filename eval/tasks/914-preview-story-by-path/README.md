# 914 – Write Story Then Preview

## Purpose

Tests whether the agent chooses the **path-based preview input** when story file context is already available, and avoids unnecessary docs lookups.

## Setup

- Pre-seeded Button component and existing stories.
- Agent must add exactly one specific story variant in the existing story file:
  - `SecondaryDisabled` with args `{ label: 'Secondary (Disabled)', disabled: true }`
- Prompt asks the agent to show a preview at the end.

## Prompt

Asks for one specific new story (`SecondaryDisabled`) with exact args and a final preview.

## Quality Signal

| Metric                                               | Weight |
| ---------------------------------------------------- | ------ |
| MCP tools coverage (`preview-stories` called)        | 10 %   |
| Preview input strategy (path + exportName preferred) | 60 %   |
| Avoid unnecessary docs fetches for button            | 30 %   |

## Expected MCP Tools

- `preview-stories` (at least 1 call)

For strategy quality credit, at least one preview invocation should pass `stories` using `absoluteStoryPath` + `exportName` and should not rely exclusively on `storyId`.

For docs-avoidance quality credit, the agent should not call `get-documentation` with `id: "button"` in this task.
