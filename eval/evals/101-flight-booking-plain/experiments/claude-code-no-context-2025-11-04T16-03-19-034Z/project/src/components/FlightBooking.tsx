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
  const [isReturn, setIsReturn] = useState(false);
  const [fromAirport, setFromAirport] = useState<Airport | null>(null);
  const [toAirport, setToAirport] = useState<Airport | null>(null);
  const [departureDate, setDepartureDate] = useState<Date | null>(null);
  const [returnDate, setReturnDate] = useState<Date | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmit) {
      onSubmit();
    }
  };

  return (
    <div className="flight-booking">
      <h1>Book a Flight</h1>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Trip Type</label>
          <ToggleButton
            value={isReturn}
            onChange={setIsReturn}
            leftLabel="One Way"
            rightLabel="Return"
            leftTestId="one-way"
            rightTestId="return"
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>From</label>
            <Autocomplete
              airports={airports}
              value={fromAirport}
              onChange={setFromAirport}
              placeholder="Select departure airport"
              testId="airport-from"
            />
          </div>

          <div className="form-group">
            <label>To</label>
            <Autocomplete
              airports={airports}
              value={toAirport}
              onChange={setToAirport}
              placeholder="Select destination airport"
              testId="airport-to"
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Departure Date</label>
            <DatePicker
              value={departureDate}
              onChange={setDepartureDate}
              placeholder="Select departure date"
              testId="datepicker-trigger-departure"
            />
          </div>

          {isReturn && (
            <div className="form-group">
              <label>Return Date</label>
              <DatePicker
                value={returnDate}
                onChange={setReturnDate}
                placeholder="Select return date"
                testId="datepicker-trigger-return"
                minDate={departureDate || undefined}
              />
            </div>
          )}
        </div>

        <button type="submit" className="submit-button" data-testid="submit">
          Search Flights
        </button>
      </form>
    </div>
  );
}
