---
'@storybook/addon-mcp': patch
---

Make display-review the single ending for visual work: the after-change instruction step now feeds story discovery into the review instead of ending at preview URLs, preview-stories is framed as a mid-loop tool, the "or you skipped it" escape is removed (non-visual changes say so plainly instead of listing links), and get-changed-stories results append a "publish the review now" next-step hint when review is enabled. Fixes agents completing visual changes but handing back preview links instead of the review.
