export interface Airport {
  code: string;
  name: string;
  city: string;
  country: string;
}

export const airports: Airport[] = [
  { code: "SYD", name: "Sydney Airport", city: "Sydney", country: "Australia" },
  { code: "MEL", name: "Melbourne Airport (Tullamarine)", city: "Melbourne", country: "Australia" },
  { code: "LAX", name: "Los Angeles International Airport", city: "Los Angeles", country: "USA" },
  { code: "JFK", name: "John F. Kennedy International Airport", city: "New York", country: "USA" },
  { code: "LHR", name: "Heathrow Airport", city: "London", country: "UK" },
  { code: "CDG", name: "Charles de Gaulle Airport", city: "Paris", country: "France" },
  { code: "ATL", name: "Hartsfield–Jackson Atlanta International Airport", city: "Atlanta", country: "USA" },
  { code: "DXB", name: "Dubai International Airport", city: "Dubai", country: "UAE" },
  { code: "HKG", name: "Hong Kong International Airport", city: "Hong Kong", country: "Hong Kong" },
  { code: "BNE", name: "Brisbane Airport", city: "Brisbane", country: "Australia" },
  { code: "PER", name: "Perth Airport", city: "Perth", country: "Australia" },
  { code: "DFW", name: "Dallas Fort Worth International Airport", city: "Dallas", country: "USA" },
];
