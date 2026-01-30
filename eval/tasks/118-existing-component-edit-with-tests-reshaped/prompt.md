Edit the `FeedbackCard` component to add a "helpful" counter feature. Users should be able to mark feedback as helpful by clicking a button, and the count should increment.

<technical_requirements>

1. Component file: `src/components/FeedbackCard.tsx` (already exists)
2. Add an optional `helpfulCount?: number` prop (default: 0)
3. Add an optional `onMarkHelpful?: () => void` callback prop
4. Display the helpful count with a thumbs-up button
5. When the button is clicked, call the `onMarkHelpful` callback
6. The button should be disabled if `onMarkHelpful` is not provided
7. Update the existing story file to include the new functionality
8. Ensure all existing stories continue to work
   </technical_requirements>
