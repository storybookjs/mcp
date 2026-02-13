# 909 – Run Tests After Component Creation

## Purpose

Tests whether the agent can create a new component and stories from scratch, then run story tests to verify them — including checking for a11y violations.

## Setup

- No pre-seeded component files — the agent must create everything.
- Agent should call `get-storybook-story-instructions` before writing stories.

## Prompt

Asks the agent to create a new component with specific props, write Storybook stories (consulting `get-storybook-story-instructions` first), but no hints about running tests.

## Quality Signal

| Metric                                        | Weight |
| --------------------------------------------- | ------ |
| MCP tools coverage (`run-story-tests` called) | 40 %   |
| Test pass rate                                | 40 %   |
| A11y violations (fewer = better)              | 20 %   |

## Expected MCP Tools

- `run-story-tests` (at least 1 call)
