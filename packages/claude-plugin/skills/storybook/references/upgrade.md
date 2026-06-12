# Storybook Upgrade

> Read this when Storybook exists but needs an upgrade or MCP repair —
> including when proxy repair instructions mention upgrading Storybook.

## Workflow

1. Inspect Storybook packages in `package.json` files and identify the repository root. In monorepos, Storybook's upgrade command should usually be run from the repository root.
2. Check the project's current Storybook major version before choosing a target.
3. Upgrade one major version at a time unless Storybook's own docs explicitly allow a larger jump for that source version.
4. Use Storybook's official upgrade command:

```sh
npx storybook@latest upgrade
```

5. If you only need configuration repairs, use:

```sh
npx storybook automigrate
```

6. If the MCP addon is missing after upgrade, install it:

```sh
npx storybook add @storybook/addon-mcp
```

7. Run Storybook's health check when useful:

```sh
npx storybook doctor
```

8. Read [`references/claude-launch.md`](claude-launch.md) and follow it to configure or repair `.claude/launch.json`, then start Storybook through that launch entry. If the user still needs configuration or stories, read [`references/setup.md`](setup.md).

## Guardrails

- Do not skip across multiple major versions unless the official Storybook upgrade path supports it.
- Preserve user changes in Storybook config files and story files.
- If the upgrade command creates a `debug-storybook.log`, read it before guessing at fixes.
- Do not start Storybook as an ad hoc Bash command or background task in Claude; use the Claude launcher entry.
