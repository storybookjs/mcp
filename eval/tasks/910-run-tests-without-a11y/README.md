# 910 – Run Tests Without A11y

**Phase:** Parameter passing · **Difficulty:** Easy–Medium

## Purpose

Tests whether the agent can pass the `{ a11y: false }` option to `run-story-tests` when instructed to skip accessibility checks. Has multiple prompt variants to test how explicit the instruction needs to be.

## Setup

- Pre-seeded Button component with Default and Disabled stories.
- Stories will surface a11y violations unless `a11y: false` is passed.

## Prompt Variants

All variants ask the agent to run story tests. They differ in how explicitly they hint at disabling a11y:

| File                   | Hint level                                       |
| ---------------------- | ------------------------------------------------ |
| `prompt.md`            | No a11y hint at all                              |
| `prompt.concise.md`    | Brief instruction to ignore a11y                 |
| `prompt.explicit.md`   | Spells out the exact `{ a11y: false }` argument  |
| `system.a11y-false.md` | Same explicit hint, delivered as a system prompt |

## Quality Signal

| Metric                                                           | Weight |
| ---------------------------------------------------------------- | ------ |
| MCP tools coverage (`run-story-tests` called with `a11y: false`) | 50 %   |
| Test pass rate                                                   | 50 %   |

## Expected MCP Tools

- `run-story-tests` with `{ a11y: false }` argument
