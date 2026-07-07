---
name: init
description: Use when adding Storybook to a project that does not have Storybook configured yet.
---

Prerequisites:

1. **Storybook is not installed** (no Storybook dependencies in `package.json`, no `.storybook/` directory): invoke the `$storybook:init` skill, but only if the user explicitly approves a Storybook installation.
2. **Storybook is installed but outdated** (version < 10.5 and not an alpha/canary version): invoke the `$storybook:upgrade` skill, but only if the user explicitly approved a Storybook upgrade.
3. **Storybook is installed and up to date**: proceed. Ensure `@storybook/addon-mcp` is installed; if it is missing, install it with `npx storybook add @storybook/addon-mcp`.

1. Run `npm create storybook@latest` inside your project's root directory to install the latest version of Storybook. Use the matching package-manager command when appropriate, such as `pnpm create storybook@latest` or `yarn create storybook`.
2. After initialization succeeds, run `npx storybook add @storybook/addon-mcp`.
3. Invoke the `$storybook:setup` skill to help the user set up project-specific Storybook configuration, such as the `.storybook/preview.ts` file.
