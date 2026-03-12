# 901 - Create Component (Atom, Reshaped)

## Purpose

Tests whether the agent can build a small, accessible atomic component from scratch, add stories, and validate behavior using Storybook MCP tooling.

## Setup

- Reshaped is installed in trial setup.
- The task asks for a new `ToggleSwitch` component at `src/components/ToggleSwitch.tsx`.
- Prompt variants include concise, detailed, and explicit-story guidance.

## Prompt

Asks the agent to create an accessible `ToggleSwitch` with keyboard interaction and disabled behavior. Concise prompt (`prompt.concise.md`) is intentionally brief.

## Quality Signal

| Metric                                                  | Weight |
| ------------------------------------------------------- | ------ |
| MCP tools coverage (`get-storybook-story-instructions`) | 50 %   |
| MCP tools coverage (`preview-stories`)                  | 50 %   |

## Expected MCP Tools

- `get-storybook-story-instructions` (at least 1 call)
- `preview-stories` (at least 1 call)
