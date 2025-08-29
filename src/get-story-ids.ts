import path from "node:path";
import { storyNameFromExport } from "storybook/internal/csf";
import { logger } from "storybook/internal/node-logger";
import type { StoryIndex } from "storybook/internal/types";
import z from "zod";

const inputStoriesSchema = z.array(
  z.object({
    exportName: z.string(),
    explicitStoryName: z.string().optional(),
    absoluteStoryPath: z.string(),
  }),
);

export async function getStoryIds(
  stories: z.infer<typeof inputStoriesSchema>,
  origin: string,
) {
  const index: StoryIndex = await (await fetch(`${origin}/index.json`)).json();

  const entriesList = Object.values(index.entries);
  logger.debug("index entries found:", entriesList.length);

  const result: (string | undefined)[] = [];

  for (const { exportName, explicitStoryName, absoluteStoryPath } of stories) {
    const relativePath = `./${path.relative(process.cwd(), absoluteStoryPath)}`;

    logger.debug("Searching for:");
    logger.debug({
      exportName,
      explicitStoryName,
      absoluteStoryPath,
      relativePath,
    });

    const foundStoryId = entriesList.find(
      (entry) =>
        entry.importPath === relativePath &&
        [explicitStoryName, storyNameFromExport(exportName)].includes(
          entry.name,
        ),
    )?.id;

    if (foundStoryId) {
      logger.debug("Found story ID:", foundStoryId);
      result.push(foundStoryId);
    } else {
      logger.debug("Could not find story ID for:", {
        exportName,
        explicitStoryName,
        absoluteStoryPath,
      });
      result.push(undefined);
    }
  }
  return result;
}
