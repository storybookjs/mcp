Build a small "Mission control" page using the `LaunchButton` component from the Acme UI Storybook docs.

Do not guess any required library or root setup. Use the available Storybook MCP docs to discover both component usage and any project-level setup requirements before wiring the component in.

Requirements:

1. Implement the page component in `src/components/MissionControl.tsx`
2. `src/components/MissionControl.tsx` must default export the component, otherwise the existing static story will fail
3. Update `src/main.tsx` to render that component
4. Do not create stories yourself; static stories already exist for this component
5. Render the heading text `Mission control`
6. Render a `LaunchButton` with the text `Open dashboard`
7. Keep the implementation minimal and production-like
