Leverage the following Storybook MCP tools for guidance and best practices when working with component stories:

- Use the `storybook-dev-mcp` tool `get-storybook-story-instructions` to fetch the latest instructions for creating or updating stories. This will ensure you follow current conventions and recommendations.

**CRITICAL: Never hallucinate component properties!** Before using ANY property on a component (including common-sounding ones `shadow`, etc.), you MUST use Storybook MCPs:

1. Query `list-all-documentation` to get a list of all components
2. Second query `get-documentation` for that component to see all available properties
3. If the property you need isn't listed, query `get-documentation-for-story` to check example stories for alternative ways to achieve the desired styling
4. Only use properties that are explicitly documented or shown in example stories
5. If a property isn't documented, it doesn't exist - do not assume properties based on naming conventions or common patterns from other libraries. Check back with the user in these cases.

Remember: A story name might not reflect the property name correctly, so always verify properties through documentation or example stories before using them.
