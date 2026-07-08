---
'@storybook/claude-code-plugin': patch
'@storybook/codex-plugin': patch
---

The stories skill now directs agents to run the Storybook dev server and every `storybook ai` command from the same working directory — the package where Storybook is installed. In monorepos where Storybook lives in a leaf package, agents previously ran `storybook ai` from the repo root, hit the degraded `--help` of storybookjs/storybook#35359, and missed the entire workflow.
