export interface Airport {
  code: string;
  name: string;
}

export const airports: Airport[] = [
  { code: "SYD", name: "Sydney Airport, Australia" },
  { code: "MEL", name: "Melbourne Airport (Tullamarine), Australia" },
  { code: "LAX", name: "Los Angeles International Airport, USA" },
  { code: "JFK", name: "John F. Kennedy International Airport, New York, USA" },
  { code: "LHR", name: "Heathrow Airport, London, UK" },
  { code: "CDG", name: "Charles de Gaulle Airport, Paris, France" },
  { code: "ATL", name: "Hartsfield–Jackson Atlanta International Airport, USA" },
  { code: "DXB", name: "Dubai International Airport, UAE" },
  { code: "HKG", name: "Hong Kong International Airport, Hong Kong" },
  { code: "BNE", name: "Brisbane Airport, Australia" },
  { code: "PER", name: "Perth Airport, Australia" },
  { code: "DFW", name: "Dallas Fort Worth International Airport, USA" },
];
