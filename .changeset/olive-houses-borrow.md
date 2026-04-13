---
'@storybook/addon-mcp': patch
---

Add optional ARIA snapshot capture to story test runs.

The `run-story-tests` tool now accepts `ariaSnapshot: true` to include Playwright AI-mode accessibility tree snapshots alongside HTML and screenshots. The addon now registers the required Vitest browser command through its preset's `viteFinal` hook so Storybook browser tests can capture ARIA snapshots without extra consumer wiring.
