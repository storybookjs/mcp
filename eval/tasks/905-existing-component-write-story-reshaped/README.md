# 905 - Existing Component: Write Story (Reshaped)

## Purpose

Tests whether the agent can discover and document states for an existing component by writing complete stories from scratch.

## Setup

- Reshaped is installed in trial setup.
- `AlertBanner` already exists at `src/components/AlertBanner.tsx`.
- The task is to create `stories/AlertBanner.stories.tsx` with key variants.

## Prompt

Asks the agent to author stories for `info`, `success`, `warning`, `error`, and dismissible behavior. Concise prompt (`prompt.concise.md`) gives only the target file and component.

## Quality Signal

| Metric                                                  | Weight |
| ------------------------------------------------------- | ------ |
| MCP tools coverage (`get-storybook-story-instructions`) | 50 %   |
| MCP tools coverage (`run-story-tests`)                  | 50 %   |

## Expected MCP Tools

- `get-storybook-story-instructions` (at least 1 call)
- `run-story-tests` (at least 1 call)
