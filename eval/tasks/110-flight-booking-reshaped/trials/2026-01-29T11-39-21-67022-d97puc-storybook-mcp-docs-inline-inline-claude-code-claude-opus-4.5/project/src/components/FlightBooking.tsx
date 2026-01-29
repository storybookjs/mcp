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

const AIRPORTS = [
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

interface FlightBookingProps {
  onSubmit?: () => void;
}

export default function FlightBooking({ onSubmit }: FlightBookingProps) {
  const [tripType, setTripType] = useState<string[]>(["return"]);
  const [fromAirport, setFromAirport] = useState("");
  const [toAirport, setToAirport] = useState("");
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [departureDate, setDepartureDate] = useState<Date | null>(null);
  const [returnDate, setReturnDate] = useState<Date | null>(null);
  const [departurePopoverActive, setDeparturePopoverActive] = useState(false);
  const [returnPopoverActive, setReturnPopoverActive] = useState(false);

  const isReturn = tripType.includes("return");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const filteredFromAirports = AIRPORTS.filter(
    (airport) =>
      airport.code.toLowerCase().includes(fromQuery.toLowerCase()) ||
      airport.name.toLowerCase().includes(fromQuery.toLowerCase())
  );

  const filteredToAirports = AIRPORTS.filter(
    (airport) =>
      airport.code.toLowerCase().includes(toQuery.toLowerCase()) ||
      airport.name.toLowerCase().includes(toQuery.toLowerCase())
  );

  const formatDate = (date: Date | null): string => {
    if (!date) return "";
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
        onChange={({ value }) => setTripType(value)}
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
            onChange={({ value }) => setFromQuery(value)}
            onItemSelect={({ value }) => {
              setFromAirport(value);
              setFromQuery(value);
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
            onChange={({ value }) => setToQuery(value)}
            onItemSelect={({ value }) => {
              setToAirport(value);
              setToQuery(value);
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
                  {departureDate ? formatDate(departureDate) : "Departure Date"}
                </Button>
              )}
            </Popover.Trigger>
            <Popover.Content>
              <Calendar
                value={departureDate}
                min={today}
                onChange={({ value }) => {
                  if (value instanceof Date) {
                    setDepartureDate(value);
                    setDeparturePopoverActive(false);
                    if (returnDate && value > returnDate) {
                      setReturnDate(null);
                    }
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
                    {returnDate ? formatDate(returnDate) : "Return Date"}
                  </Button>
                )}
              </Popover.Trigger>
              <Popover.Content>
                <Calendar
                  value={returnDate}
                  min={departureDate || today}
                  onChange={({ value }) => {
                    if (value instanceof Date) {
                      setReturnDate(value);
                      setReturnPopoverActive(false);
                    }
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
}
