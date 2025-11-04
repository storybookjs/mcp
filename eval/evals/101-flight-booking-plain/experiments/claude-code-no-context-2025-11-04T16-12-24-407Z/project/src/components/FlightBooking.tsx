import { useState } from "react";
import { Autocomplete } from "./Autocomplete";
import { ToggleButton } from "./ToggleButton";
import { DatePicker } from "./DatePicker";
import { airports } from "../data/airports";
import type { Airport } from "../data/airports";
import "./FlightBooking.css";

interface FlightBookingProps {
  onSubmit?: () => void;
}

export default function FlightBooking({ onSubmit }: FlightBookingProps) {
  const [tripType, setTripType] = useState<"one-way" | "return">("return");
  const [fromAirport, setFromAirport] = useState<Airport | null>(null);
  const [toAirport, setToAirport] = useState<Airport | null>(null);
  const [departureDate, setDepartureDate] = useState<Date | null>(null);
  const [returnDate, setReturnDate] = useState<Date | null>(null);

  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit();
    }
  };

  return (
    <div className="flight-booking">
      <h1 className="flight-booking__title">Book Your Flight</h1>

      <div className="flight-booking__form">
        <div className="flight-booking__section">
          <label className="flight-booking__label">Trip Type</label>
          <ToggleButton
            options={[
              { value: "one-way", label: "One Way", testId: "one-way" },
              { value: "return", label: "Return", testId: "return" },
            ]}
            value={tripType}
            onChange={(value) => {
              setTripType(value as "one-way" | "return");
              if (value === "one-way") {
                setReturnDate(null);
              }
            }}
          />
        </div>

        <div className="flight-booking__section">
          <label className="flight-booking__label">From</label>
          <Autocomplete
            airports={airports}
            value={fromAirport}
            onChange={setFromAirport}
            placeholder="Select departure airport"
            testId="airport-from"
          />
        </div>

        <div className="flight-booking__section">
          <label className="flight-booking__label">To</label>
          <Autocomplete
            airports={airports}
            value={toAirport}
            onChange={setToAirport}
            placeholder="Select destination airport"
            testId="airport-to"
          />
        </div>

        <div className="flight-booking__dates">
          <div className="flight-booking__section flight-booking__section--half">
            <label className="flight-booking__label">Departure Date</label>
            <DatePicker
              selectedDate={departureDate}
              onSelectDate={setDepartureDate}
              placeholder="Select departure date"
              testId="datepicker-trigger-departure"
            />
          </div>

          {tripType === "return" && (
            <div className="flight-booking__section flight-booking__section--half">
              <label className="flight-booking__label">Return Date</label>
              <DatePicker
                selectedDate={returnDate}
                onSelectDate={setReturnDate}
                placeholder="Select return date"
                testId="datepicker-trigger-return"
                minDate={departureDate || undefined}
              />
            </div>
          )}
        </div>

        <div className="flight-booking__section">
          <button
            data-testid="submit"
            onClick={handleSubmit}
            className="flight-booking__submit"
          >
            Search Flights
          </button>
        </div>
      </div>
    </div>
  );
}
