---
'@storybook/addon-mcp': patch
---

Add optional ARIA snapshot and computed style capture to story test runs.

The `run-story-tests` tool now accepts `ariaSnapshot: true` to include Playwright AI-mode accessibility tree snapshots alongside HTML and screenshots.

It also accepts `computedStyles: true` to include per-element computed CSS style differences, filtered against an isolated same-tag browser baseline so the output focuses on non-default styles that actually affect the rendered story.

The addon now registers the required Vitest browser command through its preset's `viteFinal` hook so Storybook browser tests can capture ARIA snapshots without extra consumer wiring, and it prepares the computed-style baseline iframe up front through the preview lifecycle while still supporting lazy fallback creation when needed.
