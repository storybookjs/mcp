# 914 – Preview Story By Path

## Purpose

Tests whether the agent chooses the **path-based preview input** after reading story-file context directly from disk.

## Setup

- Pre-seeded Button component and existing stories.
- Prompt first asks the agent to read `stories/Button.stories.tsx` and report its imports.
- Prompt then asks the agent to preview existing `Primary` and `Secondary` stories.
- No file edits are expected.

## Prompt

Asks the agent to inspect story file imports first, then preview `Primary` and `Secondary`.

## Quality Signal

| Metric                                                 | Weight |
| ------------------------------------------------------ | ------ |
| Preview input strategy (path + exportName preferred)   | 50 %   |
| Avoid `get-documentation` calls for Button identifiers | 10 %   |
| Final response includes both preview URLs              | 40 %   |

## Expected MCP Tools

- `preview-stories` (at least 1 call)

For strategy quality credit, at least one preview invocation should pass `stories` using `absoluteStoryPath` + `exportName` and should not rely exclusively on `storyId`.

For docs-avoidance quality credit, the agent should not call `get-documentation` with any Button-like ID (for example, `button` or `example-button`).

For final-response quality credit, the final assistant response should include preview URLs for both `example-button--primary` and `example-button--secondary`.
