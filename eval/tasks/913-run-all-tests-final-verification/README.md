# 913 – Run All Tests for Final Verification

## Purpose

Tests whether the agent knows when to run a full project story test sweep using `run-story-tests` without specifying `stories`.

## Setup

- Pre-seeded `Button` and `StatusPill` components with test-tagged stories.
- Stories are expected to pass.
- Agent is asked to perform a final project-wide verification run.

## Prompt

Asks the agent to run Storybook story tests for the whole project.

## Quality Signal

This task uses a manual quality check in `hooks.ts` based on how `run-story-tests` is called.

### Scoring rubric

- **0.0**: `run-story-tests` is not called at all.
- **0.3**: `run-story-tests` is called, but only with a non-empty `stories` input.
- **1.0**: At least one `run-story-tests` call is made without `stories`, with `stories: undefined`, or with `stories: []`.

## Expected MCP Tools

- `run-story-tests`
