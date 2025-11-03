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

The calendar widget shouldn't allow selecting dates in the past and the return flight must be after the outward flight.

<technical_requirements>
  1. The <FlightBooking /> component MUST be a default export in src/components/FlightBooking.tsx
  2. The <FlightBooking /> component MUST be added to the main.tsx file as the ONLY component being rendered
  3. The element for the "One Way"-toggle SHOULD have a data-testid="one-way" attribute
  4. The element for the "Return"-toggle SHOULD have a data-testid="return" attribute
  5. The button to open the Departure Date datepicker SHOULD have a data-testid="datepicker-trigger-departure" attribute
  6. The (optional) button to open the Retrun Date datepicker SHOULD have a data-testid="datepicker-trigger-return" attribute
  7. Each date in the datepickers SHOULD have a data-testid="date-<DATE_NUMBER>" attribute
  8. The submit button SHOULD have a data-testid="submit" attribute
</technical_requirements>
