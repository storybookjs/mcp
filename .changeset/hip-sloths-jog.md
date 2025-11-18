---
'@storybook/mcp': minor
---

Replace the `source` property in the context with `request`.

Now you don't pass in a source string that might be fetched or handled by your custom `manifestProvider`, but instead you pass in the whole web request. (This is automatically handled if you use the createStorybookMcpHandler() function).

The default action is now to fetch the manifest from `../manifests/components.json` assuming the server is running at `./mcp`. Your custom `manifestProvider()`-function then also does not get a source string as an argument, but gets the whole web request, that you can use to get information about where to fetch the manifest from. It also gets a second argument, `path`, which it should use to determine which specific manifest to get from a built Storybook. (Currently always `./manifests/components.json`, but in the future it might be other paths too).
