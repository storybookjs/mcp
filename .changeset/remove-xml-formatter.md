---
'@storybook/mcp': minor
'@storybook/addon-mcp': minor
---

Remove XML formatter and simplify format pattern to use only markdown.

**BREAKING CHANGE**: The `format` option has been removed from both `@storybook/mcp` and `@storybook/addon-mcp`. Previously, you could configure the output format as either `'xml'` or `'markdown'`. Now, all output is formatted as markdown by default.

**Migration guide**:
- If you were using `format: 'markdown'` (the default), no changes are needed.
- If you were using `format: 'xml'`, this option no longer has any effect. All documentation is now formatted as markdown.
- The `experimentalFormat` option in `@storybook/addon-mcp` addon options has been removed.
- The `format` property in `StorybookContext` has been removed from `@storybook/mcp`.

**What changed**:
- Removed XML formatter implementation
- Simplified formatter pattern to directly use markdown
- Removed `OutputFormat` type union
- Removed `format` parameter from all formatting functions
- Updated CLI tools (`bin.ts`, `serve.ts`) to remove format arguments
