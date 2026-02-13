# 908 – Run Story Tests

## Purpose

Baseline eval: can the agent discover and invoke the `run-story-tests` MCP tool when asked to test existing stories?

## Setup

- Pre-seeded Button component with Default and Disabled stories (both passing, no a11y issues).
- No file edits expected — the agent should only run tests and report results.

## Prompt

Asks the agent to run story tests for existing Button stories and report results. No hints about fixing or editing files.

## Quality Signal

| Metric                                        | Weight |
| --------------------------------------------- | ------ |
| MCP tools coverage (`run-story-tests` called) | 100 %  |

## Expected MCP Tools

- `run-story-tests` (at least 1 call)
