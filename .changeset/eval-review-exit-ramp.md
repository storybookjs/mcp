---
'@storybook/addon-mcp': patch
---

Make display-review the single ending for visual work: the after-change instruction step now feeds story discovery into the review instead of ending at preview URLs, preview-stories is framed as a mid-loop tool, the "or you skipped it" escape is removed (non-visual changes say so plainly instead of listing links), and get-changed-stories results append a "publish the review now" next-step hint when review is enabled. Fixes agents completing visual changes but handing back preview links instead of the review.

The preview-stories tool also closes the review exit ramp: when review is enabled its description states display-review's availability as fact instead of hedging with "when available" (which let an agent that wrongly believed the tool was missing treat raw links as a sanctioned fallback), and its results append a recovery nudge pointing finished visual work and browse requests back to display-review. When review is disabled, the description no longer mentions display-review at all — the tool is not registered in those sessions.

The get-storybook-story-instructions story-linking workflow gets the same review-aware rewrite: with review enabled it now routes discovered story IDs into display-review and forbids constructing IDs from file names or memory, instead of framing get-changed-stories as a preview-stories helper. This is the only workflow guidance CLI/plugin agents receive (they never see the MCP server instructions), and agents were observed publishing reviews with hand-derived story IDs because the discovery discipline was missing from their instruction channel.
