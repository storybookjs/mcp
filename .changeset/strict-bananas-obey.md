---
'@storybook/addon-mcp': patch
---

Added `run-story-tests` tool that is available when:

1. `@storybook/addon-vitest` is configured
2. Running Storybook 10.3.0-alpha.8 or above

Additionally, if `@storybook/addon-a11y` is configured, the tool returns accessibility violations too.
