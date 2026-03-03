import type { Preview } from "@storybook/react-vite";
import React from "react";
import { BurritoProvider } from "@janeapp/burrito-design-system";

const preview: Preview = {
  decorators: [
    (Story) => (
      <BurritoProvider>
        <Story />
      </BurritoProvider>
    ),
  ],
  parameters: {
    options: {
      storySort: {
        order: [
          "Summary",
          "Conversation",
          "Build",
          "Typecheck",
          "Lint",
          "Source",
        ],
      },
    },
  },
};

export default preview;
