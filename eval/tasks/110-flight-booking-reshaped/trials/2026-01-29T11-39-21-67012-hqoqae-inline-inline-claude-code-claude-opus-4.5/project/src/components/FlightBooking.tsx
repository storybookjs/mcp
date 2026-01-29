import { useState, useMemo } from "react";
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

type TripType = "oneway" | "return";

interface FlightBookingProps {
  onSubmit?: () => void;
}

function FlightBooking({ onSubmit }: FlightBookingProps) {
  const [tripType, setTripType] = useState<TripType>("oneway");
  const [fromAirport, setFromAirport] = useState("");
  const [toAirport, setToAirport] = useState("");
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [departureDate, setDepartureDate] = useState<Date | null>(null);
  const [returnDate, setReturnDate] = useState<Date | null>(null);
  const [departurePopoverActive, setDeparturePopoverActive] = useState(false);
  const [returnPopoverActive, setReturnPopoverActive] = useState(false);

  const today = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);

  const filteredFromAirports = useMemo(() => {
    const query = fromQuery.toLowerCase();
    if (!query) return AIRPORTS;
    return AIRPORTS.filter(
      (airport) =>
        airport.code.toLowerCase().includes(query) ||
        airport.name.toLowerCase().includes(query)
    );
  }, [fromQuery]);

  const filteredToAirports = useMemo(() => {
    const query = toQuery.toLowerCase();
    if (!query) return AIRPORTS;
    return AIRPORTS.filter(
      (airport) =>
        airport.code.toLowerCase().includes(query) ||
        airport.name.toLowerCase().includes(query)
    );
  }, [toQuery]);

  const handleTripTypeChange = (args: { value: string[] }) => {
    if (args.value.length > 0) {
      setTripType(args.value[0] as TripType);
      if (args.value[0] === "oneway") {
        setReturnDate(null);
      }
    }
  };

  const handleFromSelect = (args: { value: string }) => {
    setFromAirport(args.value);
    setFromQuery(args.value);
  };

  const handleToSelect = (args: { value: string }) => {
    setToAirport(args.value);
    setToQuery(args.value);
  };

  const handleDepartureDateChange = (args: { value: Date }) => {
    setDepartureDate(args.value);
    setDeparturePopoverActive(false);
    // Reset return date if it's before the new departure date
    if (returnDate && args.value > returnDate) {
      setReturnDate(null);
    }
  };

  const handleReturnDateChange = (args: { value: Date }) => {
    setReturnDate(args.value);
    setReturnPopoverActive(false);
  };

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

  // Calculate minimum date for return calendar
  const returnMinDate = departureDate || today;

  return (
    <View gap={4} padding={4}>
      <ToggleButtonGroup
        value={[tripType]}
        onChange={handleTripTypeChange}
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
            onInput={(e) => setFromQuery(e.value)}
            onItemSelect={handleFromSelect}
          >
            {filteredFromAirports.map((airport) => (
              <Autocomplete.Item
                key={airport.code}
                value={`${airport.code}: – ${airport.name}`}
              >
                {airport.code}: – {airport.name}
              </Autocomplete.Item>
            ))}
          </Autocomplete>
        </View.Item>

        <View.Item grow>
          <Autocomplete
            name="to"
            placeholder="To"
            value={toQuery}
            onInput={(e) => setToQuery(e.value)}
            onItemSelect={handleToSelect}
          >
            {filteredToAirports.map((airport) => (
              <Autocomplete.Item
                key={airport.code}
                value={`${airport.code}: – ${airport.name}`}
              >
                {airport.code}: – {airport.name}
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
                <Button {...attributes} variant="outline" fullWidth>
                  {departureDate ? formatDate(departureDate) : "Departure Date"}
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
        </View.Item>

        {tripType === "return" && (
          <View.Item grow>
            <Popover
              active={returnPopoverActive}
              onOpen={() => setReturnPopoverActive(true)}
              onClose={() => setReturnPopoverActive(false)}
            >
              <Popover.Trigger>
                {(attributes) => (
                  <Button {...attributes} variant="outline" fullWidth>
                    {returnDate ? formatDate(returnDate) : "Return Date"}
                  </Button>
                )}
              </Popover.Trigger>
              <Popover.Content>
                <Calendar
                  value={returnDate}
                  onChange={handleReturnDateChange}
                  min={returnMinDate}
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

export default FlightBooking;
