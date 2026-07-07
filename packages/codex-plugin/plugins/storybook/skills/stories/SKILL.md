---
name: stories
description: Invoke FIRST, before creating, editing, or deleting components, stories, styles, CSS, themes, colors, or design tokens — anything that changes how the UI looks, no exceptions. Also for starting or previewing Storybook to verify UI, requests to show, browse, or list components, stories, or UI states, and docs, props, or usage lookups.
---

Prerequisites:

1. **Storybook is not installed** (no Storybook dependencies in `package.json`, no `.storybook/` directory): invoke the `$storybook:init` skill, but only if the user explicitly approves a Storybook installation.
2. **Storybook is installed but outdated** (version < 10.5 and not an alpha/canary version): invoke the `$storybook:upgrade` skill, but only if the user explicitly approved a Storybook upgrade.
3. **Storybook is installed and up to date**: proceed. Ensure `@storybook/addon-mcp` is installed; if it is missing, install it with `npx storybook add @storybook/addon-mcp`.

Run `STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai --help` and read the output in its **entirety** to get the **mandatory, ordered workflow** for working on UI changes, writing stories, and keeping stories in sync with every frontend component you create, modify, or delete. This workflow explains how to write stories, preview stories, and display a curated Storybook review.

Before invoking any `storybook ai` command for the first time in a session, run `STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai <command> --help` and read it fully. The top-level help only lists the commands; each command's payload shape and usage rules (which fields to include when) live in its own help output. Never guess a `--json` payload from the command name — a validation error only reports missing required fields, not the optional fields the workflow expects you to provide.
