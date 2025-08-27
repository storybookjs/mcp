import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GET_STORY_URLS_TOOL_NAME } from "./get-story-urls";

const INSTRUCTIONS = `
  # Writing User Interfaces Components

  When writing UI components, prefer breaking larger components up into smaller parts.

  ALWAYS write a Storybook story for any component written. If editing a component, ensure appropriate changes have been made to stories for that component.

  When writing stories, use CSF3 importing types from '@storybook/nextjs-vite'. Here is a simple example:

  \`\`\`ts
  import { Meta, StoryObj } from '@storybook/nextjs-vite';

  import { Break } from './Break';

  type Story = StoryObj<typeof Break>;

  const meta: Meta<typeof Break> = {
    component: Break,
    args: {},
  };

  export default meta;

  export const Horizontal: Story = {
    args: {
      orientation: 'horizontal',
    },
  };
  \`\`\`

  ALWAYS provide story links after any changes to stories files, including changes to existing stories.
  After changing any UI components, ALWAYS search for related stories that might cover the changes you've made.
  If you find any, provide the story links to the user. THIS IS VERY IMPORTANT, as it allows the user
  to visually inspect the modifications you've made.
  Even later in a session when changing UI components or stories that have already been linked to previously, YOU MUST PROVIDE THE LINKS AGAIN.
  Use the ${GET_STORY_URLS_TOOL_NAME} tool /and provide links in the format \`[Story Name](<story_url_from_tool>)\`
  whenever you create, modify, or update any story file.
`;

export function registerUIBuildingTool(server: McpServer) {
  server.registerTool(
    "get_ui_building_instructions",
    {
      title: "UI Component Building Instructions",
      description: `Instructions on how to do UI component development. 
      
      ALWAYS call this tool before doing any UI/frontend/React/component development, including but not
      limited to adding or updating new components, pages, screens or layouts.`,
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: INSTRUCTIONS }],
    }),
  );
}
