---
name: stories
description: Invoke FIRST, before creating, editing, or deleting components, stories, styles, CSS, themes, colors, or design tokens — anything that changes how the UI looks, no exceptions. Also for starting or previewing Storybook to verify UI, requests to show, browse, or list components, stories, or UI states, and docs, props, or usage lookups.
---

Prerequisites:

1. Storybook must be installed in the project. Invoke the `/storybook-init` skill to set up Storybook, but only if the user explicitly invoked this skill and approves a Storybook installation.
2. Storybook must be >= 10.5 (or an alpha/canary version). Invoke the `/storybook-upgrade` skill to upgrade it, but only if the user
   explicitly approved a Storybook upgrade.
3. Ensure `@storybook/addon-mcp` is installed. If it is missing, install it with `npx storybook add @storybook/addon-mcp`.

First locate the package where Storybook is installed: the package whose `package.json` lists the `storybook` dependency and that contains the `.storybook/` config directory. In a monorepo that is usually a leaf package (e.g. `packages/ui`), not the repo root. Run **all** Storybook commands — starting the dev server, `storybook add`, and every `storybook ai` invocation — from that package's directory, never from the repo root: `cd` into it (e.g. `cd packages/ui && STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai --help`). `storybook ai` finds a running dev server by the exact directory it was started from, so the dev server and every `storybook ai` command must run from the same directory; a dev server started from the repo root — even with `--config-dir` pointing at the package — is invisible to `storybook ai` run from the package. A delegating root script such as `npm run storybook --workspace <pkg>` is safe: the package manager runs it inside the package. If `storybook ai --help` reports that the Storybook config could not be loaded or lists no Storybook commands, it ran in the wrong directory — rerun it from the Storybook package.

Run `STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai --help` and read the output in its **entirety** to get the **mandatory, ordered workflow** for working on UI changes, writing stories, and keeping stories in sync with every frontend component you create, modify, or delete. This workflow explains how to write stories, preview stories, and display a curated Storybook review.

Before invoking any `storybook ai` command for the first time in a session, run `STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai <command> --help` and read it fully. The top-level help only lists the commands; each command's payload shape and usage rules (which fields to include when) live in its own help output. Never guess a `--json` payload from the command name — a validation error only reports missing required fields, not the optional fields the workflow expects you to provide.

Some commands require a running Storybook dev server. When Claude preview tooling is available, start the dev server through that tooling:

1. Ensure there is a Storybook launch entry in `.claude/launch.json` (the `preview_start` tool description documents the file format) with `autoPort: true` and `port: 6006`. Use the project's preferred package manager and existing `package.json` Storybook script instead of inventing a new command whenever possible. In a monorepo the launch entry must start the dev-server process inside the Storybook package's directory so `storybook ai` commands run from that package can find it: delegate through the package manager (an existing root `storybook` script that does e.g. `npm run storybook --workspace <pkg> --`, or equivalent `runtimeArgs`) — never a root-level `storybook dev --config-dir <pkg>/.storybook`.
2. Start the Storybook launch entry with the `preview_start` tool.
