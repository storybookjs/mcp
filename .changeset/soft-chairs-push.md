---
'@storybook/addon-mcp': patch
---

Add tools to get documentation for components, based on the component manifest being generated in the Storybook dev server.

Requirements:

1. That the **experimental** feature flag `features.experimentalComponentsManifest` is set to `true` in the main config.
2. Only React-based frameworks supports component manifest generation for now.
3. Requires Storybook v10.1 (prereleases), which at the time of writing is available as a canary version `0.0.0-pr-32810-sha-af0645cd`.
