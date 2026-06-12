# Storybook Setup

> Read this when Storybook is already installed and the user wants a working
> `preview` file and colocated stories for real components.

## Prerequisites

1. Confirm Storybook exists (`package.json`, `.storybook/`). If not, switch to the init workflow: read [`references/init.md`](init.md).
2. If Storybook is outdated or upgrade/repair is needed first, read [`references/upgrade.md`](upgrade.md) and follow it.

## Run the CLI

From the project root (or the Storybook package in a monorepo):

```sh
npx storybook ai setup
```

Use the repo's package manager when appropriate: `pnpm exec storybook ai setup`, `yarn exec storybook ai setup`.

**Follow the printed Markdown precisely.** Do not substitute your own plan.
