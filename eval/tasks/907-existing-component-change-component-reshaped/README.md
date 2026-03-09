# 907 - Existing Component: Change Component + Stories (Reshaped)

## Purpose

Tests whether the agent can evolve an existing component API and keep its stories in sync, rather than only editing stories.

## Setup

- Reshaped is installed in trial setup.
- `ReviewCard` exists in `src/components/ReviewCard.tsx`.
- Existing stories are present at `stories/ReviewCard.stories.tsx` and must be updated after component changes.

## Prompt

Asks the agent to add a required `date` prop and optional `onReport` action to `ReviewCard`, then update stories to include the new prop and a report-button variant. Concise prompt (`prompt.concise.md`) is intentionally concise.

## Quality Signal

| Metric                                                  | Weight |
| ------------------------------------------------------- | ------ |
| MCP tools coverage (`get-storybook-story-instructions`) | 50 %   |
| MCP tools coverage (`run-story-tests`)                  | 50 %   |

## Expected MCP Tools

- `get-storybook-story-instructions` (at least 1 call)
- `run-story-tests` (at least 1 call)
