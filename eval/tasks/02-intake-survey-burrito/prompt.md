Create an intake survey form component that includes:

- An h1 heading "Facials intake survey" at the top
- A read-only "Survey ID" field pre-filled with "123-45"
- A required "Full name" text input
- A "Which best describes your skin type?" question with radio button options (all disabled):
  - Normal skin
  - Dry skin
  - Oily skin
  - Combination skin
  - Sensitive skin
- A required "Do you have any of the following conditions?" question with checkboxes (select all that apply):
  - Acne
  - Autoimmune disease
  - Blood disorder
  - Cancer (with helper text: "Optional - this information is collected voluntarily, according to our privacy policy.")
  - Eczema
- A "Cancel" button and a primary "Submit" button

The form should be wrapped in a Card component, with the Cancel and Submit buttons in the Card's footer area.

The "Survey ID" and "Full name" text inputs SHOULD have a max width of 272px.

The conditions field is required — display a validation error "At least one condition must be selected." if the user submits without selecting any condition.

## Technical requirements

- The <IntakeSurvey /> component MUST be a default export in src/components/IntakeSurvey.tsx
- The <IntakeSurvey /> component MUST accept an optional onSubmit(values) prop called with the form values object when conditions validation passes and the form is submitted
- The form values object passed to onSubmit MUST have the shape: { surveyId: string, fullName: string, skinType: string | null, conditions: string[] }
- The <IntakeSurvey /> component MUST accept an optional onCancel() prop called when the Cancel button is clicked
- There MUST be no lint errors in the generated code — resolve any lint errors before completing the task
- There SHOULD be no test errors in the generated code — attempt to resolve any Vitest/Playwright errors before completing the task
