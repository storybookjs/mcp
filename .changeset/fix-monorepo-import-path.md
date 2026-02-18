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

Path normalization now uses `normalizeStoryPath` from `storybook/internal/common` to stay consistent with how Storybook core canonicalizes `importPath`.
