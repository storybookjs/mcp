import { useEffect, useGlobals } from "storybook/preview-api";
import type {
  Renderer,
  StoryContext,
  PartialStoryFn as StoryFunction,
} from "storybook/internal/types";

import { KEY } from "./constants";

export const withGlobals = (
  StoryFn: StoryFunction<Renderer>,
  context: StoryContext<Renderer>,
) => {
  const [globals] = useGlobals();
  const myAddon = globals[KEY];
  const canvas = context.canvasElement as ParentNode;

  // Is the addon being used in the docs panel
  const isInDocs = context.viewMode === "docs";

  useEffect(() => {
    if (!isInDocs) {
      addExtraContentToStory(canvas, {
        myAddon,
      });
    }
  }, [myAddon, isInDocs]);

  return StoryFn();
};

/**
 * It's not really recommended to inject content into the canvas like this.
 * But there are use cases
 */
function addExtraContentToStory(canvas: ParentNode, state: Object) {
  const preElement =
    canvas.querySelector(`[data-id="${KEY}"]`) ||
    canvas.appendChild(document.createElement("pre"));

  preElement.setAttribute("data-id", KEY);
  preElement.setAttribute(
    "style",
    `
    margin-top: 1rem;
    padding: 1rem;
    background-color: #eee;
    border-radius: 3px;
    overflow: scroll;
  `,
  );

  preElement.innerHTML = `This snippet is injected by the withGlobals decorator.
It updates as the user interacts with the ⚡ or Theme tools in the toolbar above.

${JSON.stringify(state, null, 2)}
`;
}
