import { LightningIcon } from "@storybook/icons";
import React, { useCallback } from "react";
import { Code, H1, IconButton, Link } from "storybook/internal/components";
import { useGlobals, useParameter } from "storybook/manager-api";
import { styled } from "storybook/theming";

import { KEY } from "../constants";

interface TabProps {
  active: boolean;
}

const TabWrapper = styled.div(({ theme }) => ({
  background: theme.background.content,
  padding: "4rem 20px",
  minHeight: "100vh",
  boxSizing: "border-box",
}));

const TabInner = styled.div({
  maxWidth: 768,
  marginLeft: "auto",
  marginRight: "auto",
});

export const Tab: React.FC<TabProps> = ({ active }) => {
  // https://storybook.js.org/docs/react/addons/addons-api#useparameter
  const config = useParameter<string>(
    KEY,
    "fallback value of config from parameter",
  );

  // https://storybook.js.org/docs/addons/addons-api#useglobals
  const [globals, updateGlobals] = useGlobals();
  const value = globals[KEY];

  const update = useCallback((newValue: typeof value) => {
    updateGlobals({
      [KEY]: newValue,
    });
  }, []);

  if (!active) {
    return null;
  }

  return (
    <TabWrapper>
      <TabInner>
        <H1>My Addon ({KEY})</H1>
        <p>Your addon can create a custom tab in Storybook.</p>
        <p>
          You have full control over what content is being rendered here. You
          can use components from{" "}
          <Link href="https://github.com/storybookjs/storybook/blob/next/code/core/src/components/README.md">
            storybook/internal/components
          </Link>{" "}
          to match the look and feel of Storybook, for example the{" "}
          <code>&lt;Code /&gt;</code> component below. Or build a completely
          custom UI.
        </p>
        <Code>{config}</Code>
        <p>
          You can also have interactive UI here, like a button that updates a
          global:{" "}
          <IconButton
            active={!!value}
            onClick={() => {
              update(!value);
            }}
          >
            <LightningIcon />
          </IconButton>
        </p>
      </TabInner>
    </TabWrapper>
  );
};
