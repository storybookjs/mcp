import { useState, useRef, useEffect } from 'react';
import './FlightBooking.css';

interface Airport {
  code: string;
  name: string;
}

const AIRPORTS: Airport[] = [
  { code: 'SYD', name: 'Sydney Airport, Australia' },
  { code: 'MEL', name: 'Melbourne Airport (Tullamarine), Australia' },
  { code: 'LAX', name: 'Los Angeles International Airport, USA' },
  { code: 'JFK', name: 'John F. Kennedy International Airport, New York, USA' },
  { code: 'LHR', name: 'Heathrow Airport, London, UK' },
  { code: 'CDG', name: 'Charles de Gaulle Airport, Paris, France' },
  { code: 'ATL', name: 'Hartsfield–Jackson Atlanta International Airport, USA' },
  { code: 'DXB', name: 'Dubai International Airport, UAE' },
  { code: 'HKG', name: 'Hong Kong International Airport, Hong Kong' },
  { code: 'BNE', name: 'Brisbane Airport, Australia' },
  { code: 'PER', name: 'Perth Airport, Australia' },
  { code: 'DFW', name: 'Dallas Fort Worth International Airport, USA' },
];

const FlightBooking = () => {
  const [isReturn, setIsReturn] = useState(true);
  const [fromAirport, setFromAirport] = useState<Airport | null>(null);
  const [toAirport, setToAirport] = useState<Airport | null>(null);
  const [departureDate, setDepartureDate] = useState<Date | null>(null);
  const [returnDate, setReturnDate] = useState<Date | null>(null);

  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [showDeparturePicker, setShowDeparturePicker] = useState(false);
  const [showReturnPicker, setShowReturnPicker] = useState(false);

  const [fromSearch, setFromSearch] = useState('');
  const [toSearch, setToSearch] = useState('');

  const fromPickerRef = useRef<HTMLDivElement>(null);
  const toPickerRef = useRef<HTMLDivElement>(null);
  const departurePickerRef = useRef<HTMLDivElement>(null);
  const returnPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (fromPickerRef.current && !fromPickerRef.current.contains(event.target as Node)) {
        setShowFromPicker(false);
      }
      if (toPickerRef.current && !toPickerRef.current.contains(event.target as Node)) {
        setShowToPicker(false);
      }
      if (departurePickerRef.current && !departurePickerRef.current.contains(event.target as Node)) {
        setShowDeparturePicker(false);
      }
      if (returnPickerRef.current && !returnPickerRef.current.contains(event.target as Node)) {
        setShowReturnPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filterAirports = (search: string) => {
    if (!search) return AIRPORTS;
    const searchLower = search.toLowerCase();
    return AIRPORTS.filter(
      airport =>
        airport.code.toLowerCase().includes(searchLower) ||
        airport.name.toLowerCase().includes(searchLower)
    );
  };

  const formatDate = (date: Date | null) => {
    if (!date) return 'Select date';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleSubmit = () => {
    console.log({
      type: isReturn ? 'return' : 'one-way',
      from: fromAirport,
      to: toAirport,
      departureDate,
      returnDate: isReturn ? returnDate : null,
    });
  };

  return (
    <div className="flight-booking">
      <h1>Flight Booking</h1>

      <div className="trip-type">
        <button
          data-testid="one-way"
          className={!isReturn ? 'active' : ''}
          onClick={() => {
            setIsReturn(false);
            setReturnDate(null);
          }}
        >
          One Way
        </button>
        <button
          data-testid="return"
          className={isReturn ? 'active' : ''}
          onClick={() => setIsReturn(true)}
        >
          Return
        </button>
      </div>

      <div className="booking-form">
        <div className="form-row">
          <div className="form-field" ref={fromPickerRef}>
            <label>From</label>
            <button
              data-testid="airport-from"
              className="airport-select"
              onClick={() => {
                setShowFromPicker(!showFromPicker);
                setShowToPicker(false);
              }}
            >
              {fromAirport ? `${fromAirport.code} - ${fromAirport.name}` : 'Select airport'}
            </button>
            {showFromPicker && (
              <div className="airport-picker">
                <input
                  type="text"
                  placeholder="Search airports..."
                  value={fromSearch}
                  onChange={(e) => setFromSearch(e.target.value)}
                  className="airport-search"
                  autoFocus
                />
                <div className="airport-list">
                  {filterAirports(fromSearch).map((airport) => (
                    <button
                      key={airport.code}
                      data-testid={airport.code}
                      className="airport-option"
                      onClick={() => {
                        setFromAirport(airport);
                        setShowFromPicker(false);
                        setFromSearch('');
                      }}
                    >
                      <span className="airport-code">{airport.code}</span>
                      <span className="airport-name">{airport.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="form-field" ref={toPickerRef}>
            <label>To</label>
            <button
              data-testid="airport-to"
              className="airport-select"
              onClick={() => {
                setShowToPicker(!showToPicker);
                setShowFromPicker(false);
              }}
            >
              {toAirport ? `${toAirport.code} - ${toAirport.name}` : 'Select airport'}
            </button>
            {showToPicker && (
              <div className="airport-picker">
                <input
                  type="text"
                  placeholder="Search airports..."
                  value={toSearch}
                  onChange={(e) => setToSearch(e.target.value)}
                  className="airport-search"
                  autoFocus
                />
                <div className="airport-list">
                  {filterAirports(toSearch).map((airport) => (
                    <button
                      key={airport.code}
                      data-testid={airport.code}
                      className="airport-option"
                      onClick={() => {
                        setToAirport(airport);
                        setShowToPicker(false);
                        setToSearch('');
                      }}
                    >
                      <span className="airport-code">{airport.code}</span>
                      <span className="airport-name">{airport.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-field" ref={departurePickerRef}>
            <label>Departure Date</label>
            <button
              data-testid="datepicker-trigger-departure"
              className="date-select"
              onClick={() => {
                setShowDeparturePicker(!showDeparturePicker);
                setShowReturnPicker(false);
              }}
            >
              {formatDate(departureDate)}
            </button>
            {showDeparturePicker && (
              <DatePicker
                selectedDate={departureDate}
                minDate={new Date()}
                onSelect={(date) => {
                  setDepartureDate(date);
                  setShowDeparturePicker(false);
                  if (returnDate && date > returnDate) {
                    setReturnDate(null);
                  }
                }}
              />
            )}
          </div>

          {isReturn && (
            <div className="form-field" ref={returnPickerRef}>
              <label>Return Date</label>
              <button
                data-testid="datepicker-trigger-return"
                className="date-select"
                onClick={() => {
                  setShowReturnPicker(!showReturnPicker);
                  setShowDeparturePicker(false);
                }}
              >
                {formatDate(returnDate)}
              </button>
              {showReturnPicker && (
                <DatePicker
                  selectedDate={returnDate}
                  minDate={departureDate || new Date()}
                  onSelect={(date) => {
                    setReturnDate(date);
                    setShowReturnPicker(false);
                  }}
                />
              )}
            </div>
          )}
        </div>

        <button
          data-testid="submit"
          className="submit-button"
          onClick={handleSubmit}
        >
          Search Flights
        </button>
      </div>
    </div>
  );
};

interface DatePickerProps {
  selectedDate: Date | null;
  minDate: Date;
  onSelect: (date: Date) => void;
}

const DatePicker = ({ selectedDate, minDate, onSelect }: DatePickerProps) => {
  const [currentMonth, setCurrentMonth] = useState(
    selectedDate || new Date()
  );

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    return { daysInMonth, startingDayOfWeek, year, month };
  };

  const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentMonth);

  const isDateDisabled = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);
    const minDateCompare = new Date(minDate);
    minDateCompare.setHours(0, 0, 0, 0);

    return compareDate < minDateCompare;
  };

  const isDateSelected = (date: Date) => {
    if (!selectedDate) return false;
    return (
      date.getDate() === selectedDate.getDate() &&
      date.getMonth() === selectedDate.getMonth() &&
      date.getFullYear() === selectedDate.getFullYear()
    );
  };

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1));
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const days = [];
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(<div key={`empty-${i}`} className="calendar-day empty" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const disabled = isDateDisabled(date);
    const selected = isDateSelected(date);

    days.push(
      <button
        key={day}
        data-testid={`date-${day}`}
        className={`calendar-day ${disabled ? 'disabled' : ''} ${selected ? 'selected' : ''}`}
        onClick={() => !disabled && onSelect(date)}
        disabled={disabled}
      >
        {day}
      </button>
    );
  }

  return (
    <div className="date-picker">
      <div className="calendar-header">
        <button onClick={goToPreviousMonth} className="nav-button">
          ‹
        </button>
        <span className="month-year">
          {monthNames[month]} {year}
        </span>
        <button onClick={goToNextMonth} className="nav-button">
          ›
        </button>
      </div>
      <div className="calendar-weekdays">
        <div>Sun</div>
        <div>Mon</div>
        <div>Tue</div>
        <div>Wed</div>
        <div>Thu</div>
        <div>Fri</div>
        <div>Sat</div>
      </div>
      <div className="calendar-grid">{days}</div>
    </div>
  );
};

export default FlightBooking;
