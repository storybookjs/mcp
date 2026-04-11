---
'@storybook/addon-mcp': patch
---

Add optional screenshot capture to the `run-story-tests` MCP tool.

When `screenshot: true` is passed, the addon now captures a final rendered story screenshot from its preview annotation hook and returns it as MCP image content alongside the usual text test summary.
