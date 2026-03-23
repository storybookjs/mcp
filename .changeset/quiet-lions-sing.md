---
"@storybook/mcp": patch
---

Support Storybook component manifests that use `reactComponentMeta` for React prop extraction.

This keeps MCP documentation output working when Storybook is configured to emit the newer
`reactComponentMeta` payload instead of `reactDocgen` or `reactDocgenTypescript`.
