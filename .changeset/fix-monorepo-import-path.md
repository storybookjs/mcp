---
'@storybook/addon-mcp': patch
---

Fix `preview-stories` failing to find stories in monorepo packages directories.

The tool prepends `./` to computed relative paths, but Storybook's `index.json` doesn't always include that prefix (e.g. `../../packages/design-system/Button.stories.tsx` vs `./../../packages/design-system/Button.stories.tsx`). The strict `===` comparison fails silently and returns "story not found".

Paths are now normalized by stripping the leading `./` before comparison.
