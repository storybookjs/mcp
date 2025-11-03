import React, { useState, useEffect } from 'react';
import { Autocomplete } from './Autocomplete';
import { DatePicker } from './DatePicker';
import { ToggleButton } from './ToggleButton';
import { AIRPORTS, Airport } from '../../data/airports';
import './FlightBooking.css';

export const FlightBooking: React.FC = () => {
  const [tripType, setTripType] = useState<'one-way' | 'return'>('return');
  const [origin, setOrigin] = useState<Airport | null>(null);
  const [destination, setDestination] = useState<Airport | null>(null);
  const [departureDate, setDepartureDate] = useState<Date | null>(null);
  const [returnDate, setReturnDate] = useState<Date | null>(null);

  // Reset return date when switching to one-way
  useEffect(() => {
    if (tripType === 'one-way') {
      setReturnDate(null);
    }
  }, [tripType]);

  // Clear return date if it's before departure date
  useEffect(() => {
    if (departureDate && returnDate && returnDate < departureDate) {
      setReturnDate(null);
    }
  }, [departureDate, returnDate]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    if (!origin) {
      alert('Please select an origin airport');
      return;
    }
    if (!destination) {
      alert('Please select a destination airport');
      return;
    }
    if (origin.code === destination.code) {
      alert('Origin and destination must be different');
      return;
    }
    if (!departureDate) {
      alert('Please select a departure date');
      return;
    }
    if (tripType === 'return' && !returnDate) {
      alert('Please select a return date');
      return;
    }

    // Log booking details (in a real app, this would submit to a backend)
    console.log('Flight Booking Details:', {
      tripType,
      origin: `${origin.code} - ${origin.name}`,
      destination: `${destination.code} - ${destination.name}`,
      departureDate: departureDate.toLocaleDateString(),
      returnDate: returnDate ? returnDate.toLocaleDateString() : null,
    });

    alert('Flight search submitted! Check console for details.');
  };

  return (
    <div className="flight-booking">
      <h1 className="flight-booking-title">Book Your Flight</h1>
      <form onSubmit={handleSearch} className="flight-booking-form">
        <ToggleButton value={tripType} onChange={setTripType} />

        <div className="flight-route">
          <Autocomplete
            airports={AIRPORTS}
            value={origin}
            onChange={setOrigin}
            label="From"
            placeholder="Enter origin airport"
          />
          <Autocomplete
            airports={AIRPORTS}
            value={destination}
            onChange={setDestination}
            label="To"
            placeholder="Enter destination airport"
          />
        </div>

        <div className="flight-dates">
          <DatePicker
            label="Departure Date"
            selectedDate={departureDate}
            onSelectDate={setDepartureDate}
            minDate={new Date()}
          />
          {tripType === 'return' && (
            <DatePicker
              label="Return Date"
              selectedDate={returnDate}
              onSelectDate={setReturnDate}
              minDate={departureDate || new Date()}
            />
          )}
        </div>

        <button type="submit" className="search-button">
          Search Flights
        </button>
      </form>
    </div>
  );
};
