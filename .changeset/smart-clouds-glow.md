---
'@storybook/mcp': patch
'@storybook/addon-mcp': patch
---

Add story ID based inputs for preview/testing workflows and surface story IDs in docs outputs.

This change keeps existing path-based story inputs (`absoluteStoryPath` + `exportName`) while adding a `storyId` input shape for `preview-stories` and `run-story-tests`. It also adds `withStoryIds` to `list-all-documentation` and includes story IDs in `get-documentation` story sections, so agents can discover and reuse IDs directly without extra filesystem lookup steps.
