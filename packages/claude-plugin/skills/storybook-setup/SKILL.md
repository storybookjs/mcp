---
name: storybook-setup
description: Use this skill when the user wants to set up Storybook for this project or agent — whether Storybook is missing, outdated, or already installed with stories.
---

Follow this decision tree in order, from the project root (in a monorepo: the package where Storybook lives or should live, often a leaf package such as `packages/ui`):

1. **Storybook missing?** No Storybook dependency in `package.json` and no `.storybook/` directory → invoke `/storybook-init` first, then continue with step 3.
2. **Storybook outdated?** Storybook must be at least 10.5. If it is older, or upgrade/repair is needed → invoke `/storybook-upgrade` first, then continue.
3. **Ensure `@storybook/addon-mcp` is installed.** If it is missing, run `npx storybook add @storybook/addon-mcp`.
4. **Does the project already have user-written stories?** Any `*.stories.*` file beyond the `storybook init` examples (the `src/stories/` boilerplate such as Button, Header, Page) counts. If yes: the project is already set up — do **not** generate stories and do **not** run `npx storybook ai setup`. Invoke `/stories` to start Storybook and show it to the user, then stop. Exception: when the user explicitly asked for new stories, continue with step 5, scoped to what they asked for.
5. **No user-written stories?** Ensure `@storybook/addon-vitest` is installed (if it is missing, run `npx storybook add @storybook/addon-vitest`). Then run `npx storybook ai setup` and **follow the printed Markdown precisely.** Do not substitute your own plan.
