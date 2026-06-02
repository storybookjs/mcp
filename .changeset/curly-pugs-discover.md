---
"@storybook/addon-mcp": minor
---

Add the `get-stories-by-component` tool. Maps component source files to the stories that render them via Storybook's live reverse dependency graph, returning grounded story IDs ranked by import distance. Also hardens change detection: `get-changed-stories` now surfaces working-tree files that are unreachable from any story, and story-index resolution and reverse-graph lookups are normalized for cross-platform (Windows) path handling.
