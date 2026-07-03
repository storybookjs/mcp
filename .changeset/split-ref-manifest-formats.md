---
'@storybook/mcp': minor
'@storybook/addon-mcp': minor
---

Support v0 (inline) and v1 (split/ref) Storybook manifest formats. `@storybook/mcp` follows `$ref` pointers into sibling `services/` payloads for static and remote sources; `@storybook/addon-mcp` adds an in-process manifest provider for `experimentalDocgenServer` dev mode and fixes composition so local docgen-server and remote v0/v1 composed sources all work.
