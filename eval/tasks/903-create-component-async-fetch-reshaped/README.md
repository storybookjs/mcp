# 903 - Create Component (Async Fetch, Reshaped)

## Purpose

Tests whether the agent can implement async data-fetching behavior with loading, empty, and error states, then create reliable stories that mock network behavior.

## Setup

- Reshaped, `msw`, and `msw-storybook-addon` are installed in trial setup.
- The task targets a new `NotificationsList` at `src/components/NotificationsList.tsx`.
- Stories are expected to mock request outcomes (loaded, empty, error) without live calls.

## Prompt

Asks the agent to build an async list component fetching `/api/notifications`, handling abort/errors, and wiring `onSelect`. Concise prompt (`prompt.concise.md`) is short and under-specified.

## Quality Signal

| Metric                                                  | Weight |
| ------------------------------------------------------- | ------ |
| MCP tools coverage (`get-storybook-story-instructions`) | 50 %   |
| MCP tools coverage (`run-story-tests`)                  | 50 %   |

## Expected MCP Tools

- `get-storybook-story-instructions` (at least 1 call)
- `run-story-tests` (at least 1 call)
