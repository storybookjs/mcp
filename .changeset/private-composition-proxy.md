---
"@storybook/addon-mcp": patch
"@storybook/mcp": patch
---

Handle private composed Storybooks when documentation requests come through the Storybook MCP proxy.
Private composed refs now stay visible and return normal guidance to use the source Storybook's MCP endpoint instead of surfacing as tool errors.
