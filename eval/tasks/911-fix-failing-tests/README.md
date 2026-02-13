# 911 – Fix Failing Tests

## Purpose

Tests whether the agent can run story tests, encounter failures, diagnose the root cause, fix the component or stories, and re-run tests until they pass.

## Setup

- Pre-seeded Button component with Default and Disabled stories.
- The Disabled story's play function clicks a disabled button and asserts `onClick` was NOT called — but the component doesn't wire up `onClick`, so the Default story's click assertion fails.
- Expects at least 2 `run-story-tests` calls (initial run + re-run after fix).

## Prompt

Asks the agent to run story tests for the Button component. Deliberately minimal — doesn't mention that tests will fail or that fixes are needed.

## Quality Signal

| Metric                                             | Weight |
| -------------------------------------------------- | ------ |
| MCP tools coverage (`run-story-tests` called ≥ 2×) | 50 %   |
| Test pass rate (after fixes)                       | 50 %   |

## Expected MCP Tools

- `run-story-tests` (minimum 2 calls)
