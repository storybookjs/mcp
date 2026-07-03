---
'@storybook/addon-mcp': patch
'@storybook/mcp': patch
---

Slimmed the MCP server instructions from ~8.7k to under 2,048 characters in every toolset configuration. Claude Code hard-truncates MCP server instructions at 2,048 characters, so the Validation and Documentation workflow sections never reached the model and agents stopped using the documentation tools. The server instructions now only carry the workflow triggers; the detailed guidance moved into the tool descriptions and tool results (`get-stories-by-component`, `get-changed-stories`, `display-review`, `list-all-documentation`), which are never truncated. A unit test now enforces the limit for every configuration.
