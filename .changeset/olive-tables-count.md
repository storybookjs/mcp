---
'@storybook/addon-mcp': patch
---

Add Storybook 10.5 prerelease packages to the supported peer dependency range.

The `display-review` tool schema now requires `changedFiles`: pass the paths of
the files you changed (most central first), or an empty array `[]` for browse
requests where no code changed. Payloads that previously omitted the field will
fail validation.
