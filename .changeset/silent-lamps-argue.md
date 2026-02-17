---
'@storybook/mcp': patch
'@storybook/addon-mcp': patch
---

Render component-attached MDX docs entries in markdown output for `get-documentation`.

This fixes a regression where docs attached to components via `component.docs` in `components.json` were not included in markdown responses. The markdown formatter now emits a `## Docs` section below stories (and before props).
