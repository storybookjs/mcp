---
'@storybook/addon-mcp': patch
---

Slimmed the `experimentalReview` server instructions under the 2,048-character client truncation limit. Claude Code hard-truncates MCP server instructions at 2,048 characters, and the review-flavored instructions had grown to ~8.7k — the Validation and Documentation workflow sections never reached the model and agents stopped using the documentation tools. With the flag on, the dev, test, and docs sections now use slim variants that only carry the workflow triggers; the detailed guidance moved into the tool descriptions and tool results (`get-stories-by-component`, `get-changed-stories`, `display-review`, `list-all-documentation`), which are never truncated. The default (review off) instructions are unchanged. A unit test enforces the limit for every toolset configuration in both review modes.
