---
"@storybook/addon-mcp": patch
---

Surface the change-detection and review tools on the `/mcp` landing page. The "Available Toolsets" list now includes `get-stories-by-component`, `get-changed-stories`, and `display-review` under **dev** (each with an enabled/disabled badge reflecting its real runtime gate), and `get-documentation-for-story` under **docs**. The page and the MCP server now derive tool availability from a single shared helper (`getToolAvailability`) so the rendered badges can't drift from the tools that are actually registered.
