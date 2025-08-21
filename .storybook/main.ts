import { defineMain } from "@storybook/react-vite/node";

const config = defineMain({
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: ["@storybook/addon-docs", import.meta.resolve("./local-preset.ts")],
  framework: "@storybook/react-vite",
});

export default config;
