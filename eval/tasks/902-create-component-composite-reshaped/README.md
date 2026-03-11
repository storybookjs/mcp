# 902 - Create Component (Composite, Reshaped)

## Purpose

Tests whether the agent can create a composite UI component (multiple subparts and optional sections), write stories for key states, and verify outcomes with Storybook MCP tools.

## Setup

- Reshaped is installed in trial setup.
- The task targets a new `ProfileCard` at `src/components/ProfileCard.tsx`.
- Stories should cover avatar fallback, tags, and actions.

## Prompt

Asks the agent to build a `ProfileCard` with avatar/initials fallback, content sections, and accessible action buttons. Concise prompt (`prompt.concise.md`) is intentionally minimal.

## Quality Signal

| Metric                                                  | Weight |
| ------------------------------------------------------- | ------ |
| MCP tools coverage (`get-storybook-story-instructions`) | 50 %   |
| MCP tools coverage (`run-story-tests`)                  | 50 %   |

## Expected MCP Tools

- `get-storybook-story-instructions` (at least 1 call)
- `run-story-tests` (at least 1 call)
