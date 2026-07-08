---
'@storybook/addon-mcp': patch
---

Gate the `display-review` tool solely on the `changeDetection` feature flag. The previous `@storybook/addon-review` package-presence check is removed, since review is now built into Storybook core.
