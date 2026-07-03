---
'@storybook/addon-mcp': patch
'@storybook/mcp': patch
---

Close the shared-code and docs-question gaps in the default (review-off) workflow steering, which eval runs showed agents falling through:

- The dev and validation instructions now trigger on changes to "a component, a story, or shared code they use (theme, tokens, styles, utils)" instead of only "any component or story" — a theme-token edit is literally neither, so agents (GPT-5.5 on the MCP path consistently) finished shared-file changes with shell-level verification only, never calling preview-stories or run-story-tests. The preview-stories and run-story-tests descriptions carry the same trigger, including that a shared file has no stories of its own so the consumers' stories are the ones to surface, and that typecheck/lint does not replace story tests.
- The Documentation Workflow now states that props/usage *questions* must be answered from the docs tools and that component source and type definitions are not verification — agents answered docs requests by grepping component source while still producing a correct-looking answer. The get-documentation and list-all-documentation descriptions repeat that steering at the tool level, where it reaches agents even when a client truncates server instructions.

The review-off server instructions stay under the 2,048-char client truncation limit (now 2,046 chars), paid for by tightening existing sentences without dropping any rule.
