# Storybook Init

> Read this when a project does not already have Storybook configured and the
> user wants to add it.

## Workflow

1. Inspect the project to understand its framework, package manager, and workspace layout. Prefer the package manager already used by the repo.
2. Run Storybook's official initializer from the project root:

```sh
npm create storybook@latest
```

Use the matching package-manager command when appropriate, such as `pnpm create storybook@latest` or `yarn create storybook`.

3. Prefer the recommended setup unless the user asks for a minimal setup.
4. If auto-detection fails, rerun the initializer with the closest explicit `--type` value.
5. Add the MCP addon:

```sh
npx storybook add @storybook/addon-mcp
```

6. Read [`references/claude-launch.md`](claude-launch.md) and follow it to configure `.claude/launch.json`, then start Storybook through that launch entry.
7. Note the Storybook invocation directory (where `storybook dev` runs) as `cwd` when using Storybook MCP proxy tools.

## Guardrails

- Do not hand-write a full Storybook config when the official initializer can do it.
- Preserve existing app source and package manager choices.
- Do not start Storybook as an ad hoc Bash command or background task in Claude; use the Claude launcher entry.
