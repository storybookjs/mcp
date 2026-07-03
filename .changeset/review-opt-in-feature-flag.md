---
"@storybook/addon-mcp": minor
---

Make the review tooling opt-in via the new `experimentalReview` feature flag. Previously `display-review` (and the review-mode behavior of `preview-stories` / `get-changed-stories`) was enabled whenever the `changeDetection` feature flag was on — which is Storybook's default. Now review requires explicitly enabling `features.experimentalReview` in `.storybook/main.ts` (on top of `changeDetection`), so change detection stays on by default while review ships disabled by default.
