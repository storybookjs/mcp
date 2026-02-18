---
'@storybook/addon-mcp': patch
---

Fix `preview-stories` failing to find stories in monorepo packages directories.

In a monorepo like:

```
my-monorepo/
  apps/storybook/          ← Storybook runs here
  packages/design-system/  ← stories live here
```

The tool builds `./../../packages/design-system/Button.stories.tsx` but `index.json` stores `../../packages/design-system/Button.stories.tsx` (no `./`). The strict `===` fails silently.

Paths are now normalized by stripping the leading `./` before comparison.
