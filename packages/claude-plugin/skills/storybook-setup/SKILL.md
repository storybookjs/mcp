---
name: storybook-setup
description: Use this skill when Storybook is already installed and the user wants a working `preview` file and stories for real components.
---

Prerequisites:

1. Confirm Storybook exists (`package.json`, `.storybook/`). If not, switch to `/storybook-init`.
2. If Storybook is outdated or upgrade/repair is needed first, switch to `/storybook-upgrade`.

Run `npx storybook ai setup` from the directory of the package where Storybook is installed — the package whose `package.json` lists the `storybook` dependency and that contains the `.storybook/` config directory. In a monorepo that is the leaf package (e.g. `packages/ui`), never the repo root.

**Follow the printed Markdown precisely.** Do not substitute your own plan.
