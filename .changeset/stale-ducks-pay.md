---
'@storybook/mcp': minor
---

Add support for docs entries in manifests, sourced by MDX files.

# Breaking Changes

This change introduces a number of minor breaking changes to `@storybook/mcp`:

1. The lower level tool adder functions have been renamed:
2. `addGetComponentDocumentationTool` -> `addGetDocumentationTool`
3. `addListAllComponentsTool` -> `addListAllDocumentationTool`
4. The optional tool hooks have been renamed:
5. `onListAllComponents` -> `onListAllDocumentation`
6. `onGetComponentDocumentation` -> `onGetDocumentation`
7. The exported `MANIFEST_PATH` constant have been removed in favor of two new constants, `COMPONENT_MANIFEST_PATH` and `DOCS_MANIFEST_PATH`
