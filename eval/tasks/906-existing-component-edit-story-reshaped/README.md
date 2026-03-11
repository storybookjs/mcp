# 906 - Existing Component: Edit Story (Reshaped)

## Purpose

Tests whether the agent can repair outdated stories so they match current component props and behavior.

## Setup

- Reshaped is installed in trial setup.
- `PlanCard` exists in `src/components/PlanCard.tsx` with a newer prop contract.
- `stories/PlanCard.stories.tsx` is intentionally stale and must be fixed.

## Prompt

Asks the agent to align existing stories with current `PlanCard` props and include default, popular, and many-features scenarios. Concise prompt (`prompt.concise.md`) only points to mismatch.

## Quality Signal

| Metric                                                  | Weight |
| ------------------------------------------------------- | ------ |
| MCP tools coverage (`get-storybook-story-instructions`) | 50 %   |
| MCP tools coverage (`run-story-tests`)                  | 50 %   |

## Expected MCP Tools

- `get-storybook-story-instructions` (at least 1 call)
- `run-story-tests` (at least 1 call)
