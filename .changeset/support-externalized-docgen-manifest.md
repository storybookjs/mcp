---
'@storybook/mcp': patch
---

Support the externalized-docgen component manifest format. Newer Storybooks emit a `components.json` whose entries are lightweight stubs carrying a `docgen.$ref` pointer instead of inline `path`/docgen data, with the full component data served from a referenced file. `get-documentation` and `get-documentation-for-story` now resolve that reference (through the same auth-aware manifest provider) before formatting, so composition/multi-source documentation works against Storybooks using the new format. `path` and the top-level manifest `v` field are now optional to accommodate stubs and referenced docgen files.
