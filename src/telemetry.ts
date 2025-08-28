import { logger } from "storybook/internal/node-logger";
import { telemetry } from "storybook/internal/telemetry";

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

const mcpSessionIdToClientMap: Record<string, string> = {};

export const setClientForSession = (sessionId: string, client: string) => {
  mcpSessionIdToClientMap[sessionId] = client;
};

let disableTelemetry = false;
export const setDisableTelemetry = (value = false) => {
  disableTelemetry = value;
};
