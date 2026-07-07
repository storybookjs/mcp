---
name: storybook-setup
description: Use this skill when Storybook is already installed and the user wants a working `preview` file and stories for real components.
---

Prerequisites:

1. Confirm Storybook exists (`package.json`, `.storybook/`). If not, switch to `/storybook-init`.
2. If Storybook is outdated or upgrade/repair is needed first, switch to `/storybook-upgrade`.

Run `npx storybook ai setup` from the directory that contains the `.storybook/` config — in a monorepo where Storybook is installed in a leaf package, that is the leaf package's directory (e.g. `packages/ui`), not the repo root.

**Follow the printed Markdown precisely.** Do not substitute your own plan.
