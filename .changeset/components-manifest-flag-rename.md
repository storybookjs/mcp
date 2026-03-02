---
'@storybook/addon-mcp': patch
'@storybook/mcp': patch
---

Rename feature flag `experimentalComponentsManifest` → `componentsManifest`

The Storybook feature flag has been renamed from `experimentalComponentsManifest` to `componentsManifest` and now defaults to `true` in Storybook core.

The addon is backwards compatible with older Storybook versions that still use the old flag name — it checks `features.componentsManifest` first and falls back to `features.experimentalComponentsManifest`.

**Migration:** Update your `.storybook/main.js` if you had the flag explicitly set:

```js
// Before
features: { experimentalComponentsManifest: true }

// After
features: { componentsManifest: true }
// Or omit entirely — it defaults to true in recent Storybook versions
```
