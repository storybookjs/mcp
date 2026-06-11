---
"@storybook/addon-mcp": patch
---

Removed the `@storybook/mcp-proxy` package and all references to it. The proxy is no longer required as CLI commands within skill are used instead. Cleaned up proxy-related auth options and headers from `@storybook/addon-mcp`.
