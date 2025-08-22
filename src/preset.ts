import type { Plugin } from "vite";
// You can use presets to augment the Storybook configuration
// You rarely want to do this in addons,
// so often you want to delete this file and remove the reference to it in package.json#exports and package.json#bunder.nodeEntries
// Read more about presets at https://storybook.js.org/docs/addons/writing-presets

export const viteFinal = async (config: any) => {
  const mcpHandlerPlugin: Plugin = {
    name: "storybook:mcp-server",
    configureServer(server) {
      server.middlewares.use("/mcp", (req, res, next) => {
        console.log("MCP REQUEST!");
        // Handle requests to the MCP server
        next();
      });
    },
  };
  return {
    ...config,
    plugins: config.plugins.concat(mcpHandlerPlugin),
  };
};
