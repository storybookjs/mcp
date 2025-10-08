import { logger as storybookLogger } from "storybook/internal/node-logger";

/**
 * Safe logger wrapper that provides fallback for Storybook < 9.12.0
 * In those versions, the logger object does not have `debug` method.
 */
export const logger = {
  ...storybookLogger,
  debug: (...args: any[]): void => {
    if (typeof storybookLogger.debug === "function") {
      storybookLogger.debug(...args);
    } else {
      const joinedMessage = args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg) : String(arg),
        )
        .join("\n");
      storybookLogger.info(joinedMessage);
    }
  },
};
