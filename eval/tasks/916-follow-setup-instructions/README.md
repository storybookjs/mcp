# 916 – Follow Setup Instructions

## Purpose

Tests whether the agent discovers and applies **project-level setup guidance** via `get-setup-instructions` before using a documented component.

## Setup

- A fake `@acme/ui` package is pre-seeded into the trial project after preparation.
- The Storybook MCP docs context exposes:
  - component docs for `launch-button`
  - **two** docs entries tagged `setup-instructions`
- The setup docs intentionally include specific requirements that can be graded afterward:
  - import `@acme/ui/styles.css`
  - wrap the app in `<AcmeProvider theme="midnight" density="comfortable">`
  - render the UI inside an element with `data-acme-app="true"`

## Prompt

Asks the agent to build a small page with `LaunchButton` in `src/main.tsx` and not guess any library setup.

## Quality Signal

| Metric                                                 | Weight |
| ------------------------------------------------------ | ------ |
| MCP tools coverage (`get-setup-instructions`)          | 50 %   |
| Test pass rate (setup instructions were actually used) | 50 %   |

## Expected MCP Tools

- `get-setup-instructions` (at least 1 call)
- `get-documentation` (at least 1 call for `launch-button`)
