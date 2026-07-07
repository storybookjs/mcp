---
name: storybook-init
description: Use when adding Storybook to a project that does not have Storybook configured yet.
---

1. Run `npm create storybook@latest` inside your project's root directory to install the latest version of Storybook. Use the matching package-manager command when appropriate, such as `pnpm create storybook@latest` or `yarn create storybook`. In a monorepo, run it inside the directory of the package that should get Storybook (e.g. `packages/ui`), not the repo root.
2. After initialization succeeds, run `npx storybook add @storybook/addon-mcp` from that same directory.
3. Invoke the `/storybook-setup` skill to help the user set up project-specific Storybook configuration, such as the `.storybook/preview.ts` file.
