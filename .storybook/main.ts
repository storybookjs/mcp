import { defineMain } from "@storybook/react-vite/node";

const config = defineMain({
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: ["@storybook/addon-docs", import.meta.resolve("../dist/preset.js")],
  framework: "@storybook/react-vite",
  logLevel: "debug",
});

export default config;
