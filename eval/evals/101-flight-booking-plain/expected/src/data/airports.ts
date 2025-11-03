export interface Airport {
  code: string;
  name: string;
  country: string;
}

export const AIRPORTS: Airport[] = [
  { code: 'SYD', name: 'Sydney Airport', country: 'Australia' },
  { code: 'MEL', name: 'Melbourne Airport (Tullamarine)', country: 'Australia' },
  { code: 'LAX', name: 'Los Angeles International Airport', country: 'USA' },
  { code: 'JFK', name: 'John F. Kennedy International Airport, New York', country: 'USA' },
  { code: 'LHR', name: 'Heathrow Airport, London', country: 'UK' },
  { code: 'CDG', name: 'Charles de Gaulle Airport, Paris', country: 'France' },
  { code: 'ATL', name: 'Hartsfield–Jackson Atlanta International Airport', country: 'USA' },
  { code: 'DXB', name: 'Dubai International Airport', country: 'UAE' },
  { code: 'HKG', name: 'Hong Kong International Airport', country: 'Hong Kong' },
  { code: 'BNE', name: 'Brisbane Airport', country: 'Australia' },
  { code: 'PER', name: 'Perth Airport', country: 'Australia' },
  { code: 'DFW', name: 'Dallas Fort Worth International Airport', country: 'USA' },
];
