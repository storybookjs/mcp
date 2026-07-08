---
'@storybook/codex-plugin': patch
---

The Codex stories skill now steers the dev-server flow: reuse a running Storybook or start one in the background via the project's existing `storybook` script, leave it running when the work is done, and open the resulting Storybook link in Codex's in-app browser through the `control-in-app-browser` skill so the user sees the result side by side inside Codex.
