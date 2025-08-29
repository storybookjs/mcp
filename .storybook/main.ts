import { defineMain } from "@storybook/react-vite/node";

const config = defineMain({
  stories: [
    "../src/**/*.mdx",
    "../src/stories/components/**/*.stories.@(js|jsx|ts|tsx)",
    {
      titlePrefix: "Other UI",
      directory: "../src/stories/other",
      files: "**/*.stories.@(js|jsx|ts|tsx)",
    },
  ],
  addons: [
    "@storybook/addon-docs",
    import.meta.resolve("../dist/preset.js"),
    "@storybook/addon-vitest"
  ],
  framework: "@storybook/react-vite",
  logLevel: "debug",
});

export default config;
