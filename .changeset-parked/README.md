# Temporarily parked changesets

These are the pending `@storybook/addon-mcp` (and plugin) changesets, moved out of
`.changeset/` for exactly one merge so the changesets GitHub action publishes
`@storybook/mcp@0.8.0` on its own — the action only runs the publish step when
`.changeset/` contains zero changeset files, and `@storybook/addon-mcp` must NOT
be released before Storybook 10.5 (see the 10.5 release order).

A follow-up PR moves every file here back into `.changeset/` (and deletes this
directory), after which the bot regenerates the Version Packages PR as an
addon-mcp-only release. If you find this directory and `@storybook/mcp@0.8.0`
is already on npm, that follow-up is what's missing — restore these files.
