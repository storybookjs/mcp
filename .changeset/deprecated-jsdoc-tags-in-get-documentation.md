---
"@storybook/mcp": patch
---

Surface component `@deprecated` JSDoc tags in `get-documentation` output

Component-level JSDoc tags were extracted into the manifest but never rendered by the
markdown formatter, so `get-documentation` silently dropped `@deprecated`. It is now
shown as a `> **Deprecated:** <reason>` callout under the component and subcomponent
headings, resolved from the docgen-server manifest (top-level `jsDocTags.deprecated`) and
from react-docgen-typescript / `reactComponentMeta` output (the engine's `tags.deprecated`).
