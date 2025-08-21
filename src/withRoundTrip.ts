import { Result } from "src/types";
import { useEffect, useChannel } from "storybook/preview-api";
import type { DecoratorFunction } from "storybook/internal/types";

import { EVENTS } from "./constants";

/**
 * This is an example of a function that performs some sort of analysis on the
 * canvas. In this example, it returns the bounding rectangles for elements that
 * - have a style attribute
 * - are divs with fewer than 2 childNodes
 */
const check = (canvas: ParentNode = globalThis.document): Result => {
  const divs = canvas.querySelectorAll("div");
  const all = canvas.querySelectorAll("*");

  return {
    divs: Array.from(divs)
      .filter((element) => element.childNodes.length < 2)
      .map((div) => div.getBoundingClientRect()),
    styled: Array.from(all)
      .filter((element) => element.hasAttribute("style"))
      .map((element) => element.getBoundingClientRect()),
  };
};

export const withRoundTrip: DecoratorFunction = (storyFn, context) => {
  const canvasElement = context.canvasElement as ParentNode;
  const emit = useChannel({
    [EVENTS.REQUEST]: () => {
      emit(EVENTS.RESULT, check(canvasElement));
    },
  });
  useEffect(() => {
    emit(EVENTS.RESULT, check(canvasElement));
  });

  return storyFn();
};
