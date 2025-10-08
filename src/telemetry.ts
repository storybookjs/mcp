import { telemetry } from "storybook/internal/telemetry";
import { logger } from "./tools/logger";

export async function collectTelemetry({
  event,
  mcpSessionId,
  ...payload
}: {
  event: string;
  mcpSessionId: string;
  [key: string]: any;
}) {
  if (disableTelemetry) {
    return;
  }

  try {
    return await telemetry("addon-mcp" as any, {
      event,
      mcpSessionId,
      client: mcpSessionIdToClientMap[mcpSessionId!],
      ...payload,
    });
  } catch (error) {
    logger.debug("Error collecting telemetry:", error);
  }
}

export const mcpSessionIdToClientMap: Record<string, string> = {};

let disableTelemetry = false;
export const setDisableTelemetry = (value = false) => {
  disableTelemetry = value;
};
