---
"@storybook/addon-mcp": minor
---

Resolve the Storybook story index in-process instead of fetching `/index.json` over HTTP. The addon now reads the dev server's memoised `StoryIndexGenerator` (via the `storyIndexGenerator` preset) and exposes it to the tools through the server context, so the index is always live and HMR-fresh with no loopback request.

This requires Storybook `>= 10.2.0` (where the story index generator was introduced); the `storybook` peer dependency range has been bumped accordingly.
