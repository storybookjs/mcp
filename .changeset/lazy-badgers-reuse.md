---
'@storybook/addon-mcp': patch
---

Refine the review/preview workflow so agents reuse the running Storybook and present a single set of links:

- **Reuse the running Storybook.** A successful tool call proves Storybook is already running, so the agent is instructed never to start another instance (no `storybook dev`, launcher, or new port) just to view a review — a busy port is the instance to reuse, not a conflict to route around.
- **`display-review` triggers on insight requests too.** Beyond post-change reviews, it now fires when the user wants to browse stories/components (e.g. "show me all badge components"), rendering exactly those stories with no diff (`changedFiles` omitted).
- **One set of links in the final response.** When `display-review` is available, the response links only the curated review page ("You can see a curated summary of stories in the Storybook review page"); otherwise it lists the individual preview URLs — never both.
