import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const INSTRUCTIONS = `
  # Writing User Interfaces

  When writing UI, prefer breaking larger components up into smaller parts.

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

  After completing each step of the process, provide a link to each story added or modified in the format [Story Name](https://storybook.dev-chromatic.com/?path=/story/<storyId>).
`;

export function registerUIBuildingTool(server: McpServer) {
  server.registerTool(
    "getUIBuildingInstructions",
    {
      title: "UI Building Instructions",
      description: `Instructions on how to do UI development. 
      
      ALWAYS call this tool before doing any UI/frontend/React development, including but not
      limited to adding or updating new components, pages, screens or layouts.`,
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: INSTRUCTIONS }],
    }),
  );
}
