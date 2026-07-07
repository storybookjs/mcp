---
name: stories
description: Invoke FIRST, before creating, editing, or deleting components, stories, styles, CSS, themes, colors, or design tokens — anything that changes how the UI looks, no exceptions. Also for starting or previewing Storybook to verify UI, requests to show, browse, or list components, stories, or UI states, and docs, props, or usage lookups.
---

Prerequisites:

1. Storybook must be installed in the project. Invoke the `$storybook:init` skill to set up Storybook, but only if the user explicitly invoked this skill and approves a Storybook installation.
2. Storybook must be >= 10.5 (or an alpha/canary version). Invoke the `$storybook:upgrade` skill to upgrade it, but only if the user
   explicitly approved a Storybook upgrade.
3. Ensure `@storybook/addon-mcp` is installed. If it is missing, install it with `npx storybook add @storybook/addon-mcp`.

Storybook commands are directory-sensitive: `storybook ai` loads the Storybook config relative to its working directory and finds the running dev server by the exact directory the dev process was started from. Run every `storybook ai` command from the same directory the Storybook dev server runs in, mirroring its `--config-dir` flag if the dev command uses one. That directory is wherever the `storybook dev` process actually executes:

- A root `storybook` script that runs `storybook dev` directly executes at the repo root — run `storybook ai` from the root too.
- A root script that delegates to a workspace package (e.g. `npm run storybook --workspace <pkg>`, `pnpm --filter <pkg> run storybook`) executes inside that package — run `storybook ai` from that package's directory.
- In a monorepo where Storybook is only installed in a leaf package (its `package.json` lists the `storybook` dependency and it contains the `.storybook/` config) and the root has no storybook script, run the dev server and every `storybook ai` command from that package's directory: `cd` into it (e.g. `cd packages/ui && STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai --help`).

`storybook ai --cwd <dir>` (placed before the command name) behaves exactly as if run from `<dir>`. If `storybook ai --help` reports that the Storybook config could not be loaded or lists no Storybook commands, the working directory does not match — rerun it from the dev server's directory.

Run `STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai --help` and read the output in its **entirety** to get the **mandatory, ordered workflow** for working on UI changes, writing stories, and keeping stories in sync with every frontend component you create, modify, or delete. This workflow explains how to write stories, preview stories, and display a curated Storybook review.

Before invoking any `storybook ai` command for the first time in a session, run `STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai <command> --help` and read it fully. The top-level help only lists the commands; each command's payload shape and usage rules (which fields to include when) live in its own help output. Never guess a `--json` payload from the command name — a validation error only reports missing required fields, not the optional fields the workflow expects you to provide.
