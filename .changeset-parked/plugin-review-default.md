---
'@storybook/addon-mcp': minor
---

Enabled the review workflow by default for the `storybook ai` CLI channel (the Claude/Codex plugins). Requests carrying the trusted local-client header get `display-review` and the review instructions without setting `experimentalReview`; direct MCP clients keep the opt-in flag, and `experimentalReview: false` turns review off for both channels.
