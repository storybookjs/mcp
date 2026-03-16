---
'@storybook/mcp': patch
'@storybook/addon-mcp': patch
---

Add a `get-setup-instructions` MCP tool that returns docs entries tagged with `setup-instructions`.

This gives agents an explicit way to fetch installation, provider, theming, and bootstrap guidance before using component APIs. The tool is only listed when the docs manifest includes a tagged setup entry, and addon-mcp now re-exports it alongside the existing docs toolset.
