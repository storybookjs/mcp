---
'@storybook/mcp': patch
---

Minimize token usage by only including the 3 first stories in component documentation.

... if there are already prop types. If there are no prop types, include all stories. Additional stories can be fetched individually using a new `get-documentation-for-story` tool.
