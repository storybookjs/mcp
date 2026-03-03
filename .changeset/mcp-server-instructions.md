---
'@storybook/mcp': minor
'@storybook/addon-mcp': minor
---

Add MCP server-level instructions to both packages

Both `@storybook/mcp` and `@storybook/addon-mcp` now include server instructions in the MCP `initialize` response. These instructions guide agents on how to use the available tools effectively without requiring explicit prompting from users.

**`@storybook/mcp` instructions include:**

- Tool workflow: when to use `list-all-documentation` vs `get-documentation` vs `get-documentation-for-story`
- Anti-hallucination rules: never assume component props or API shape
- Multi-source behavior guidance

**`@storybook/addon-mcp` instructions compose the `@storybook/mcp` baseline and add:**

- Always call `get-storybook-story-instructions` before writing or editing stories
- `preview-stories` usage expectations
- `run-story-tests` workflow expectations
- Toolset availability guidance (`dev`, `docs`, `test`)

The `@storybook/mcp` package also exports `STORYBOOK_MCP_INSTRUCTIONS` for consumers who want to reuse or extend the base instructions.
