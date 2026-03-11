# 904 - Create Component (Async Module, Reshaped)

## Purpose

Tests whether the agent can build an async component that depends on an imported service module, model loading/empty/error states, and author testable stories with mocked module behavior.

## Setup

- Reshaped is installed in trial setup.
- The task targets `InventoryList` in `src/components/InventoryList.tsx`.
- Data comes from `getInventory()` in `src/services/inventoryApi.ts`.

## Prompt

Asks the agent to implement a service-backed async list with robust states and add stories for loaded, empty, and error paths. Concise prompt (`prompt.concise.md`) only states the core objective.

## Quality Signal

| Metric                                                  | Weight |
| ------------------------------------------------------- | ------ |
| MCP tools coverage (`get-storybook-story-instructions`) | 50 %   |
| MCP tools coverage (`run-story-tests`)                  | 50 %   |

## Expected MCP Tools

- `get-storybook-story-instructions` (at least 1 call)
- `run-story-tests` (at least 1 call)
