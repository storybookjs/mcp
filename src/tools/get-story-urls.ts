import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import path from "node:path";
import { storyNameFromExport } from "storybook/internal/csf";
import type { Options, StoryIndex } from "storybook/internal/types";
import { logger } from "storybook/internal/node-logger";
import z from "zod";
import { collectTelemetry } from "../telemetry";
import { getStoryIds } from "../get-story-ids";

const inputStoriesSchema = z.array(
  z.object({
    exportName: z.string(),
    explicitStoryName: z.string().optional(),
    absoluteStoryPath: z.string(),
  }),
);

const outputUrlsSchema = z.array(z.string());

export const GET_STORY_URLS_TOOL_NAME = "get_story_urls";

export function registerStoryUrlsTool({
  server,
  options,
}: {
  server: McpServer;
  options: Options;
}) {
  const origin = `http://localhost:${options.port}`;
  logger.debug("MCP server origin:", origin);

  server.registerTool(
    GET_STORY_URLS_TOOL_NAME,
    {
      title: "Get stories' URLs",
      description: `Get the URL for one or more stories.`,
      inputSchema: {
        stories: inputStoriesSchema,
      },
      outputSchema: {
        urls: outputUrlsSchema,
      },
    },
    async ({ stories }, { sessionId }) => {
      const storyIds = await getStoryIds(stories, origin);

      const storyUrls = storyIds.map((storyId, index) => {
        if (storyId) {
          return `${origin}/?path=/story/${storyId}`;
        }
        const inputStory = stories[index]!;
        let errorMessage = `No story found for export name "${inputStory.exportName}" with absolute file path "${inputStory.absoluteStoryPath}"`;
        if (!inputStory.explicitStoryName) {
          errorMessage += ` (did you forget to pass the explicit story name?)`;
        }
        return errorMessage;
      });

      await collectTelemetry({
        event: "tool:getStoryUrls",
        mcpSessionId: sessionId!,
        inputStoryCount: stories.length,
        outputStoryCount: storyIds.filter(Boolean).length,
      });

      return {
        content: [
          {
            type: "text",
            text:
              storyUrls.length > 1
                ? `- ${storyUrls.join("\n- ")}`
                : storyUrls[0]!,
          },
        ],
        // Note: Claude Code seems to ignore structuredContent at the moment https://github.com/anthropics/claude-code/issues/4427
        structuredContent: { urls: storyUrls },
      };
    },
  );
}
