---
'@storybook/addon-mcp': patch
---

Drop `^9.1.16` from the `storybook` and `@storybook/addon-vitest` peer dependency ranges. The preset imports `importModule` from `storybook/internal/common`, which does not exist on the 9.1.x line, so installs against storybook 9.1.x failed during preset loading with `Unexpected module status 0` (masking a `SyntaxError` about the missing export). The peer range now starts at `^10.0.0`, the first line that provides the exports the preset needs, while still admitting storybook canaries via `^0.0.0-0`.
