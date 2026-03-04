Add a city autocomplete field to our appointment booking flow. The field should help
users find their city by typing partial text, and show a live status indicator.

Create a CityField component that:
- Accepts a `cities: string[]` prop with the list of available cities
- Has a visible label "Select city" with an info icon that includes a tooltip with the message "Start typing to choose a city"
- Shows a filtered dropdown of matching suggestions when the user types 2 or more characters
- Hides the dropdown when the input has fewer than 2 characters
- Filters case-insensitively (typing "van" matches "Vancouver")
- Supports keyboard navigation: arrow keys move through suggestions, Enter selects, Escape closes
- Clicking a suggestion updates the input to that city name
- Includes a status alert below the input showing:
  - "Empty" when the input is blank
  - "Typing..." when there's text but suggestions are not showing
  - "N suggestions for 'X'" when the dropdown is open (where N = count, X = input value)
- When the input value matches one of the provided city names:
  - the status alert shows "Valid" with a checkmark icon
  - the status alert changes to a green colour

## Technical requirements

- The `<CityField />` component MUST be a default export in `src/components/CityField.tsx`
- The `<CityField />` component MUST accept a `cities: string[]` prop
- The status alert MUST be rendered as part of `<CityField />` (not a separately exported component)

## **IMPORTANT** Agent instructions

- There MUST be no lint errors in the generated code — resolve any lint errors before completing the task
- There SHOULD be no test errors in the generated code — attempt to resolve any Vitest/Playwright errors before completing the task
