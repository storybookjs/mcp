import { useState, useMemo } from "react";
import {
  Autocomplete,
  Button,
  Calendar,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
  View,
  Reshaped,
} from "reshaped";
import "reshaped/themes/reshaped/theme.css";

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

function FlightBooking({ onSubmit }: FlightBookingProps) {
  const [tripType, setTripType] = useState<string[]>(["return"]);
  const [fromValue, setFromValue] = useState("");
  const [toValue, setToValue] = useState("");
  const [fromAirport, setFromAirport] = useState<string | null>(null);
  const [toAirport, setToAirport] = useState<string | null>(null);
  const [departureDate, setDepartureDate] = useState<Date | null>(null);
  const [returnDate, setReturnDate] = useState<Date | null>(null);
  const [departureDateOpen, setDepartureDateOpen] = useState(false);
  const [returnDateOpen, setReturnDateOpen] = useState(false);

  const isReturn = tripType[0] === "return";
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const filteredFromAirports = useMemo(() => {
    if (!fromValue) return AIRPORTS;
    const lower = fromValue.toLowerCase();
    return AIRPORTS.filter(
      (a) =>
        a.code.toLowerCase().includes(lower) ||
        a.name.toLowerCase().includes(lower)
    );
  }, [fromValue]);

  const filteredToAirports = useMemo(() => {
    if (!toValue) return AIRPORTS;
    const lower = toValue.toLowerCase();
    return AIRPORTS.filter(
      (a) =>
        a.code.toLowerCase().includes(lower) ||
        a.name.toLowerCase().includes(lower)
    );
  }, [toValue]);

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
    <Reshaped theme="reshaped">
      <View direction="column" gap={4} padding={4}>
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
              placeholder="From"
              value={fromValue}
              onInput={({ value }) => {
                setFromValue(value);
                setFromAirport(null);
              }}
              onItemSelect={({ value }) => {
                setFromValue(value);
                const airport = AIRPORTS.find((a) => a.code === value);
                if (airport) {
                  setFromAirport(airport.code);
                  setFromValue(`${airport.code} – ${airport.name}`);
                }
              }}
            >
              {filteredFromAirports.map((airport) => (
                <Autocomplete.Item key={airport.code} value={airport.code}>
                  {airport.code} – {airport.name}
                </Autocomplete.Item>
              ))}
            </Autocomplete>
          </View.Item>

          <View.Item grow>
            <Autocomplete
              placeholder="To"
              value={toValue}
              onInput={({ value }) => {
                setToValue(value);
                setToAirport(null);
              }}
              onItemSelect={({ value }) => {
                setToValue(value);
                const airport = AIRPORTS.find((a) => a.code === value);
                if (airport) {
                  setToAirport(airport.code);
                  setToValue(`${airport.code} – ${airport.name}`);
                }
              }}
            >
              {filteredToAirports.map((airport) => (
                <Autocomplete.Item key={airport.code} value={airport.code}>
                  {airport.code} – {airport.name}
                </Autocomplete.Item>
              ))}
            </Autocomplete>
          </View.Item>
        </View>

        <View direction="row" gap={4}>
          <Popover
            active={departureDateOpen}
            onOpen={() => setDepartureDateOpen(true)}
            onClose={() => setDepartureDateOpen(false)}
          >
            <Popover.Trigger>
              {(attributes) => (
                <Button {...attributes} variant="outline">
                  {formatDate(departureDate) || "Departure Date"}
                </Button>
              )}
            </Popover.Trigger>
            <Popover.Content>
              <Calendar
                value={departureDate}
                min={today}
                onChange={({ value }) => {
                  setDepartureDate(value);
                  setDepartureDateOpen(false);
                  if (returnDate && value && returnDate <= value) {
                    setReturnDate(null);
                  }
                }}
              />
            </Popover.Content>
          </Popover>

          {isReturn && (
            <Popover
              active={returnDateOpen}
              onOpen={() => setReturnDateOpen(true)}
              onClose={() => setReturnDateOpen(false)}
            >
              <Popover.Trigger>
                {(attributes) => (
                  <Button {...attributes} variant="outline">
                    {formatDate(returnDate) || "Return Date"}
                  </Button>
                )}
              </Popover.Trigger>
              <Popover.Content>
                <Calendar
                  value={returnDate}
                  min={departureDate || today}
                  onChange={({ value }) => {
                    setReturnDate(value);
                    setReturnDateOpen(false);
                  }}
                />
              </Popover.Content>
            </Popover>
          )}
        </View>

        <Button color="primary" onClick={handleSubmit}>
          Search Flights
        </Button>
      </View>
    </Reshaped>
  );
}

export default FlightBooking;
