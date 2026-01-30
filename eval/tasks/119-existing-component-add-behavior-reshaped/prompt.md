Fix the `AccordionItem` component which has a broken expand/collapse behavior. The component should properly toggle between expanded and collapsed states, but currently has a bug preventing it from working correctly.

<technical_requirements>

1. Component file: `src/components/AccordionItem.tsx` (already exists, contains a bug)
2. The component should accept: `title: string`, `children: React.ReactNode`, and optional `defaultExpanded?: boolean`
3. Fix the expand/collapse toggle functionality
4. Ensure the component properly displays/hides content when toggled
5. The expand/collapse button should have proper accessibility attributes
6. Update stories if needed to demonstrate the fix
7. Ensure the component works with the existing test suite
