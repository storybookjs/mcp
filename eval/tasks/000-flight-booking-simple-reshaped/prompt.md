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

</technical_requirements>
