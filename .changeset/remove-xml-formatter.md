---
'@storybook/mcp': minor
'@storybook/addon-mcp': minor
---

Remove XML formatter and simplify format pattern to use only markdown.

**BREAKING CHANGE**: The `format` option has been removed from both `@storybook/mcp` and `@storybook/addon-mcp`. Previously, you could configure the output format as either `'xml'` or `'markdown'`. Now, all output is formatted as markdown by default.

- The `experimentalFormat` option in `@storybook/addon-mcp` addon options has been removed.
- The `format` property in `StorybookContext` has been removed from `@storybook/mcp`.
