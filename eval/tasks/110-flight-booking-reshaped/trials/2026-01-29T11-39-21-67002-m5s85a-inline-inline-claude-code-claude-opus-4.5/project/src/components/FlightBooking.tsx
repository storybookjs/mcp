import { useState, useMemo } from "react";
import {
  Reshaped,
  View,
  Autocomplete,
  Button,
  Calendar,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
} from "reshaped";
import "reshaped/themes/reshaped/theme.css";

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

const FlightBooking = ({ onSubmit }: FlightBookingProps) => {
  const [tripType, setTripType] = useState<string[]>(["return"]);
  const [fromValue, setFromValue] = useState("");
  const [toValue, setToValue] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
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
    const search = fromInput.toLowerCase();
    return airports.filter(
      (a) =>
        a.code.toLowerCase().includes(search) ||
        a.name.toLowerCase().includes(search)
    );
  }, [fromInput]);

  const filteredToAirports = useMemo(() => {
    const search = toInput.toLowerCase();
    return airports.filter(
      (a) =>
        a.code.toLowerCase().includes(search) ||
        a.name.toLowerCase().includes(search)
    );
  }, [toInput]);

  const formatDate = (date: Date | null) => {
    if (!date) return null;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleDepartureDateChange = ({ value }: { value: Date }) => {
    setDepartureDate(value);
    setDepartureDateOpen(false);
    if (returnDate && value > returnDate) {
      setReturnDate(null);
    }
  };

  const handleReturnDateChange = ({ value }: { value: Date }) => {
    setReturnDate(value);
    setReturnDateOpen(false);
  };

  const minReturnDate = departureDate
    ? new Date(departureDate.getTime() + 24 * 60 * 60 * 1000)
    : new Date(today.getTime() + 24 * 60 * 60 * 1000);

  return (
    <Reshaped>
      <View gap={4} padding={4}>
        <ToggleButtonGroup
          value={tripType}
          onChange={({ value }) => setTripType(value)}
        >
          <ToggleButton value="oneway">One Way</ToggleButton>
          <ToggleButton value="return">Return</ToggleButton>
        </ToggleButtonGroup>

        <View gap={3}>
          <Autocomplete
            name="from"
            placeholder="From"
            value={fromValue}
            onInput={({ value }) => setFromInput(value)}
            onItemSelect={({ value, data }) => {
              setFromValue(value);
              setFromInput(data as string);
            }}
          >
            {filteredFromAirports.map((airport) => (
              <Autocomplete.Item
                key={airport.code}
                value={`${airport.code} – ${airport.name}`}
                data={`${airport.code} – ${airport.name}`}
              >
                {airport.code} – {airport.name}
              </Autocomplete.Item>
            ))}
          </Autocomplete>

          <Autocomplete
            name="to"
            placeholder="To"
            value={toValue}
            onInput={({ value }) => setToInput(value)}
            onItemSelect={({ value, data }) => {
              setToValue(value);
              setToInput(data as string);
            }}
          >
            {filteredToAirports.map((airport) => (
              <Autocomplete.Item
                key={airport.code}
                value={`${airport.code} – ${airport.name}`}
                data={`${airport.code} – ${airport.name}`}
              >
                {airport.code} – {airport.name}
              </Autocomplete.Item>
            ))}
          </Autocomplete>
        </View>

        <View direction="row" gap={3}>
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
                onChange={handleDepartureDateChange}
                min={today}
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
                  onChange={handleReturnDateChange}
                  min={minReturnDate}
                />
              </Popover.Content>
            </Popover>
          )}
        </View>

        <Button color="primary" onClick={onSubmit}>
          Search Flights
        </Button>
      </View>
    </Reshaped>
  );
};

export default FlightBooking;
