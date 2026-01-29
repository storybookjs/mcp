import React, { useState } from "react";
import {
  Autocomplete,
  Button,
  Calendar,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
  View,
} from "reshaped";

interface FlightBookingProps {
  onSubmit?: () => void;
}

const airports = [
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

const FlightBooking: React.FC<FlightBookingProps> = ({ onSubmit }) => {
  const [tripType, setTripType] = useState<string[]>(["return"]);
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [fromAirport, setFromAirport] = useState<string | null>(null);
  const [toAirport, setToAirport] = useState<string | null>(null);
  const [departureDate, setDepartureDate] = useState<Date | null>(null);
  const [returnDate, setReturnDate] = useState<Date | null>(null);
  const [departurePopoverActive, setDeparturePopoverActive] = useState(false);
  const [returnPopoverActive, setReturnPopoverActive] = useState(false);

  const isReturn = tripType.includes("return");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const filteredFromAirports = airports.filter(
    (airport) =>
      airport.code.toLowerCase().includes(fromQuery.toLowerCase()) ||
      airport.name.toLowerCase().includes(fromQuery.toLowerCase())
  );

  const filteredToAirports = airports.filter(
    (airport) =>
      airport.code.toLowerCase().includes(toQuery.toLowerCase()) ||
      airport.name.toLowerCase().includes(toQuery.toLowerCase())
  );

  const formatDate = (date: Date | null) => {
    if (!date) return null;
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit();
    }
  };

  return (
    <View gap={4} padding={4}>
      <ToggleButtonGroup
        value={tripType}
        onChange={(args) => setTripType(args.value)}
      >
        <ToggleButton value="oneway">One Way</ToggleButton>
        <ToggleButton value="return">Return</ToggleButton>
      </ToggleButtonGroup>

      <View direction="row" gap={4}>
        <View.Item grow>
          <Autocomplete
            name="from"
            placeholder="From"
            value={fromQuery}
            onChange={(args) => setFromQuery(args.value)}
            onItemSelect={(args) => {
              setFromAirport(args.value);
              setFromQuery(args.value);
            }}
          >
            {filteredFromAirports.map((airport) => (
              <Autocomplete.Item
                key={airport.code}
                value={`${airport.code} – ${airport.name}`}
              >
                {airport.code} – {airport.name}
              </Autocomplete.Item>
            ))}
          </Autocomplete>
        </View.Item>

        <View.Item grow>
          <Autocomplete
            name="to"
            placeholder="To"
            value={toQuery}
            onChange={(args) => setToQuery(args.value)}
            onItemSelect={(args) => {
              setToAirport(args.value);
              setToQuery(args.value);
            }}
          >
            {filteredToAirports.map((airport) => (
              <Autocomplete.Item
                key={airport.code}
                value={`${airport.code} – ${airport.name}`}
              >
                {airport.code} – {airport.name}
              </Autocomplete.Item>
            ))}
          </Autocomplete>
        </View.Item>
      </View>

      <View direction="row" gap={4}>
        <View.Item grow>
          <Popover
            active={departurePopoverActive}
            onOpen={() => setDeparturePopoverActive(true)}
            onClose={() => setDeparturePopoverActive(false)}
          >
            <Popover.Trigger>
              {(attributes) => (
                <Button
                  attributes={attributes}
                  variant="outline"
                  fullWidth
                >
                  {formatDate(departureDate) || "Departure Date"}
                </Button>
              )}
            </Popover.Trigger>
            <Popover.Content>
              <Calendar
                value={departureDate}
                min={today}
                onChange={(args) => {
                  setDepartureDate(args.value as Date);
                  setDeparturePopoverActive(false);
                  if (returnDate && args.value && returnDate < (args.value as Date)) {
                    setReturnDate(null);
                  }
                }}
              />
            </Popover.Content>
          </Popover>
        </View.Item>

        {isReturn && (
          <View.Item grow>
            <Popover
              active={returnPopoverActive}
              onOpen={() => setReturnPopoverActive(true)}
              onClose={() => setReturnPopoverActive(false)}
            >
              <Popover.Trigger>
                {(attributes) => (
                  <Button
                    attributes={attributes}
                    variant="outline"
                    fullWidth
                  >
                    {formatDate(returnDate) || "Return Date"}
                  </Button>
                )}
              </Popover.Trigger>
              <Popover.Content>
                <Calendar
                  value={returnDate}
                  min={departureDate || today}
                  onChange={(args) => {
                    setReturnDate(args.value as Date);
                    setReturnPopoverActive(false);
                  }}
                />
              </Popover.Content>
            </Popover>
          </View.Item>
        )}
      </View>

      <Button color="primary" onClick={handleSubmit}>
        Search Flights
      </Button>
    </View>
  );
};

export default FlightBooking;
