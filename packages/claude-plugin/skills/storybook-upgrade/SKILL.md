---
name: storybook-upgrade
description: Use this skill when Storybook exists but needs an upgrade.
---

Prerequisites:

1. **Storybook is not installed** (no Storybook dependencies in `package.json`, no `.storybook/` directory): invoke the `/storybook-init` skill, but only if the user explicitly approves a Storybook installation.
2. **Storybook is installed but outdated** (version < 10.5 and not an alpha/canary version): invoke the `/storybook-upgrade` skill, but only if the user explicitly approved a Storybook upgrade.
3. **Storybook is installed and up to date**: proceed. Ensure `@storybook/addon-mcp` is installed; if it is missing, install it with `npx storybook add @storybook/addon-mcp`.

Read https://storybook.js.org/docs/releases/upgrading.md in its **entirety** to get the latest Storybook upgrade instructions.
