---
'@storybook/addon-mcp': patch
---

Add optional screenshot and HTML DOM capture to the `run-story-tests` MCP tool.

When `screenshot: true` is passed, the addon captures a final rendered story screenshot from its preview annotation hook and returns it as MCP image content alongside the usual text test summary.

When `html: true` is passed, the addon captures the final rendered story HTML DOM string from the same preview hook and includes it in the text response for downstream inspection and debugging.
