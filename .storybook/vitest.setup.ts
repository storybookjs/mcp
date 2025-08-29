import { setProjectAnnotations } from "@storybook/react-vite";
import * as projectAnnotations from "./preview";
import * as mcpAnnotations from "../src/preview";
import * as vitestAnnotations from "@storybook/addon-vitest/preview";

// This is an important step to apply the right configuration when testing your stories.
// More info at: https://storybook.js.org/docs/api/portable-stories/portable-stories-vitest#setprojectannotations
setProjectAnnotations([projectAnnotations, mcpAnnotations, vitestAnnotations]);
