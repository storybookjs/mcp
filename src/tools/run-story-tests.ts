import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Options, StoryIndex } from "storybook/internal/types";
import { logger } from "storybook/internal/node-logger";
import z from "zod";
import { getStoryIds } from "../get-story-ids";

const inputStoriesSchema = z.array(
  z.object({
    exportName: z.string(),
    explicitStoryName: z.string().optional(),
    absoluteStoryPath: z.string(),
  }),
);

const outputUrlsSchema = z.array(z.string());

export const RUN_STORY_TESTS_TOOL_NAME = "run_story_tests";

export async function registerRunTestsTool({
  server,
  options,
}: {
  server: McpServer;
  options: Options;
}) {
  const origin = `http://localhost:${options.port}`;

  let triggerTestRun;
  try {
    const addonVitest = await import("@storybook/addon-vitest");
    triggerTestRun = addonVitest.triggerTestRun;
  } catch (error) {
    logger.debug("addon-vitest not available");
  }

  const runTestsTool = server.registerTool(
    RUN_STORY_TESTS_TOOL_NAME,
    {
      title: "Run Storybook Tests",
      description: `Run tests for one or more stories.`,
      inputSchema: {
        stories: inputStoriesSchema,
      },
    },
    async ({ stories }, { sessionId }) => {
      const storyIds = (await getStoryIds(stories, origin)).filter(Boolean);
      // TODO: what about stories that could not be found?

      const testResults = await triggerTestRun("addon-mcp", storyIds);

      logger.debug("Test results:");
      logger.debug(JSON.stringify(testResults, null, 2));

      let textResult = "";

      if (testResults.componentTestCount.error === 0) {
        textResult += `## Passing Stories

- ${testResults.storyIds.join("\n- ")}`;
      } else {
        const componentTestStatuses = testResults.storyStatuses.map(
          (statusByTypeId) => statusByTypeId["storybook/component-test"],
        );
        const passingStories = componentTestStatuses.filter(
          (status) => status.value === "status-value:success",
        );
        const failingStories = componentTestStatuses.filter(
          (status) => status.value === "status-value:error",
        );
        if (passingStories.length > 0) {
          textResult += `## Passing Stories

- ${passingStories.map((status) => status.storyId).join("\n- ")}`;
        }
        if (failingStories.length > 0) {
          textResult += `\n\n## Failing Stories

### ${failingStories
            .map(
              (status) => `${status.storyId}

${status.description}`,
            )
            .join("\n### ")}`;
        }
      }
      if (testResults.unhandledErrors.length > 0) {
        textResult += `\n\n## Unhandled Errors

### ${testResults.unhandledErrors
          .map(
            (unhandledError) => `${unhandledError.name || "Unknown Error"}

**Error message**: ${unhandledError.message || "No message available"}
**Path**: ${unhandledError.VITEST_TEST_PATH || "No path available"}
**Latest test name**: ${unhandledError.VITEST_TEST_NAME || "No test name available"}
**Stack trace**: ${unhandledError.stack || "No stack trace available"}`,
          )
          .join("\n\n### ")}`;
      }

      logger.debug(textResult);
      return {
        content: [
          {
            type: "text",
            text: textResult,
          },
        ],
      };
    },
  );

  if (!triggerTestRun) {
    // tbh I actually don't know what the difference is between this vs just not registering the tool in the first place
    logger.debug("addon-vitest not available, or not a compatible version");
    runTestsTool.disable();
  }
}
