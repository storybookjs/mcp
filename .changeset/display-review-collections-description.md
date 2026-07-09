---
'@storybook/addon-mcp': patch
---

Add a schema description to the `collections` argument of the `display-review` tool. The field now documents that collections are groups of stories to show in the review, ordered most-relevant-first, with a preferred 2-5 range. Previously it carried no description, so MCP clients and the `storybook ai display-review` help had no guidance on the argument's shape or intent.
