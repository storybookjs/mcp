Create a flight booking component that includes:

- An autocomplete component for choosing source and destination from the following list of airports:
  SYD: – Sydney Airport, Australia
  MEL: – Melbourne Airport (Tullamarine), Australia
  LAX: – Los Angeles International Airport, USA
  JFK: – John F. Kennedy International Airport, New York, USA
  LHR: – Heathrow Airport, London, UK
  CDG: – Charles de Gaulle Airport, Paris, France
  ATL: – Hartsfield–Jackson Atlanta International Airport, USA
  DXB: – Dubai International Airport, UAE
  HKG: – Hong Kong International Airport, Hong Kong
  BNE: – Brisbane Airport, Australia
  PER: – Perth Airport, Australia
  DFW: – Dallas Fort Worth International Airport, USA

- A toggle button for return vs one way
- One or two date selects that when clicked on triggers a popover with a calendar widget.

The calendar widget shouldn't allow selecting dates in the past and the return flight must be after the departure flight.

<technical_requirements>

1. The <FlightBooking /> component MUST be a default export in src/components/FlightBooking.tsx
2. The <FlightBooking /> component MUST be added to the main.tsx file as the ONLY component being rendered
3. The <FlightBooking /> component MUST take an optional onSubmit() prop that is called when the submit button is clicked
4. The element for the "One Way"-toggle SHOULD have "One Way" as its only content and SHOULD have data-testid="one-way"
5. The element for the "Return"-toggle SHOULD have a "Return" as its only content and SHOULD have data-testid="return"
6. The autocomplete to open the From airport picker SHOULD have "From" as its placeholder and SHOULD have data-testid="flight-trigger-from"
7. The autocomplete to open the To airport picker SHOULD have "To" as its placeholder and SHOULD have data-testid="flight-trigger-to"
8. Each element to select an airport in the pickers SHOULD have include both the shortcode and full airport name in its content and SHOULD have data-testid="airport-{SHORTCODE}" (e.g., "airport-MEL", "airport-LAX")
9. The element to open the Departure Date date select SHOULD have "Departure Date" as its initial content and SHOULD have data-testid="date-trigger-departure"
10. The (optional) element to open the Return Date date select SHOULD have "Return Date" as its initial content and SHOULD have data-testid="date-trigger-return"
11. Each date in the date selects SHOULD the day of month as its only content and SHOULD have data-testid="date-{DAY}" (e.g., "date-27", "date-15")
12. The submit button SHOULD have "Search Flights" as its only content and SHOULD have data-testid="search-flights"

## Critical: Storybook MCP Integration

Before doing any UI, frontend, or React development, ALWAYS call the storybook MCP server to get further instructions.

1. Call `get-storybook-story-instructions` to get the latest instructions for creating or updating stories and ui components.

### Required MCP Tool Usage

**CRITICAL: Never hallucinate component properties!** Before using ANY property on a component from this design system (including common-sounding ones like `shadow`, etc.), you MUST:

1. Call `list-all-documentation` to get a list of all components
2. Call `get-documentation` for that component to see all available properties
3. Only use properties that are explicitly documented or shown in example stories

A story name might not match the property name exactly—always verify properties in the documentation or example stories before using them.
</technical_requirements>
