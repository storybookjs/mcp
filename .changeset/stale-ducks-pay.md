---
'@storybook/mcp': minor
---

Add support for docs entries in manifests, sourced by MDX files.

# Breaking Changes

This change introduces a number of minor breaking changes to `@storybook/mcp`:

1. The lower level tool adder functions have been renamed:
1. `addGetComponentDocumentationTool` -> `addGetDocumentationTool`
1. `addListAllComponentsTool` -> `addListAllDocumentationTool`
1. The optional tool hooks have been renamed:
1. `onListAllComponents` -> `onListAllDocumentation`
1. `onGetComponentDocumentation` -> `onGetDocumentation`
1. The exported `MANIFEST_PATH` constant have been removed in favor of two new constants, `COMPONENT_MANIFEST_PATH` and `DOCS_MANIFEST_PATH`
