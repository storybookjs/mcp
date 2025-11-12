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

interface FlightBookingProps {
	onSubmit?: () => void;
}

export default function FlightBooking({ onSubmit }: FlightBookingProps) {
	const [tripType, setTripType] = useState<'oneway' | 'return'>('return');
	const [fromAirport, setFromAirport] = useState<Airport | null>(null);
	const [toAirport, setToAirport] = useState<Airport | null>(null);
	const [departureDate, setDepartureDate] = useState<Date | null>(null);
	const [returnDate, setReturnDate] = useState<Date | null>(null);

	const [fromSearch, setFromSearch] = useState('');
	const [toSearch, setToSearch] = useState('');
	const [showFromDropdown, setShowFromDropdown] = useState(false);
	const [showToDropdown, setShowToDropdown] = useState(false);
	const [showDeparturePicker, setShowDeparturePicker] = useState(false);
	const [showReturnPicker, setShowReturnPicker] = useState(false);

	const fromRef = useRef<HTMLDivElement>(null);
	const toRef = useRef<HTMLDivElement>(null);
	const departureRef = useRef<HTMLDivElement>(null);
	const returnRef = useRef<HTMLDivElement>(null);

	// Close dropdowns when clicking outside
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (fromRef.current && !fromRef.current.contains(event.target as Node)) {
				setShowFromDropdown(false);
			}
			if (toRef.current && !toRef.current.contains(event.target as Node)) {
				setShowToDropdown(false);
			}
			if (
				departureRef.current &&
				!departureRef.current.contains(event.target as Node)
			) {
				setShowDeparturePicker(false);
			}
			if (returnRef.current && !returnRef.current.contains(event.target as Node)) {
				setShowReturnPicker(false);
			}
		}

		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	const filteredFromAirports = AIRPORTS.filter(
		(airport) =>
			airport.code.toLowerCase().includes(fromSearch.toLowerCase()) ||
			airport.name.toLowerCase().includes(fromSearch.toLowerCase())
	);

	const filteredToAirports = AIRPORTS.filter(
		(airport) =>
			airport.code.toLowerCase().includes(toSearch.toLowerCase()) ||
			airport.name.toLowerCase().includes(toSearch.toLowerCase())
	);

	const handleFromSelect = (airport: Airport) => {
		setFromAirport(airport);
		setFromSearch('');
		setShowFromDropdown(false);
	};

	const handleToSelect = (airport: Airport) => {
		setToAirport(airport);
		setToSearch('');
		setShowToDropdown(false);
	};

	const handleSubmit = () => {
		if (onSubmit) {
			onSubmit();
		}
	};

	const formatDate = (date: Date) => {
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		});
	};

	return (
		<div className="flight-booking">
			<div className="trip-type-toggle">
				<button
					className={tripType === 'oneway' ? 'active' : ''}
					onClick={() => setTripType('oneway')}
					data-testid="one-way"
				>
					One Way
				</button>
				<button
					className={tripType === 'return' ? 'active' : ''}
					onClick={() => setTripType('return')}
					data-testid="return"
				>
					Return
				</button>
			</div>

			<div className="flight-inputs">
				<div className="autocomplete-wrapper" ref={fromRef}>
					<input
						type="text"
						placeholder="From"
						value={fromAirport ? `${fromAirport.code} - ${fromAirport.name}` : fromSearch}
						onChange={(e) => {
							setFromSearch(e.target.value);
							setFromAirport(null);
							setShowFromDropdown(true);
						}}
						onFocus={() => setShowFromDropdown(true)}
						data-testid="flight-trigger-from"
						className="autocomplete-input"
					/>
					{showFromDropdown && (
						<div className="autocomplete-dropdown">
							{filteredFromAirports.map((airport) => (
								<div
									key={airport.code}
									className="autocomplete-item"
									onClick={() => handleFromSelect(airport)}
									data-testid={`airport-${airport.code}`}
								>
									{airport.code} - {airport.name}
								</div>
							))}
						</div>
					)}
				</div>

				<div className="autocomplete-wrapper" ref={toRef}>
					<input
						type="text"
						placeholder="To"
						value={toAirport ? `${toAirport.code} - ${toAirport.name}` : toSearch}
						onChange={(e) => {
							setToSearch(e.target.value);
							setToAirport(null);
							setShowToDropdown(true);
						}}
						onFocus={() => setShowToDropdown(true)}
						data-testid="flight-trigger-to"
						className="autocomplete-input"
					/>
					{showToDropdown && (
						<div className="autocomplete-dropdown">
							{filteredToAirports.map((airport) => (
								<div
									key={airport.code}
									className="autocomplete-item"
									onClick={() => handleToSelect(airport)}
									data-testid={`airport-${airport.code}`}
								>
									{airport.code} - {airport.name}
								</div>
							))}
						</div>
					)}
				</div>

				<div className="date-picker-wrapper" ref={departureRef}>
					<button
						className="date-trigger"
						onClick={() => setShowDeparturePicker(!showDeparturePicker)}
						data-testid="date-trigger-departure"
					>
						{departureDate ? formatDate(departureDate) : 'Departure Date'}
					</button>
					{showDeparturePicker && (
						<Calendar
							selectedDate={departureDate}
							onSelectDate={(date) => {
								setDepartureDate(date);
								setShowDeparturePicker(false);
								// Reset return date if it's before the new departure date
								if (returnDate && date > returnDate) {
									setReturnDate(null);
								}
							}}
							minDate={new Date()}
						/>
					)}
				</div>

				{tripType === 'return' && (
					<div className="date-picker-wrapper" ref={returnRef}>
						<button
							className="date-trigger"
							onClick={() => setShowReturnPicker(!showReturnPicker)}
							data-testid="date-trigger-return"
						>
							{returnDate ? formatDate(returnDate) : 'Return Date'}
						</button>
						{showReturnPicker && (
							<Calendar
								selectedDate={returnDate}
								onSelectDate={(date) => {
									setReturnDate(date);
									setShowReturnPicker(false);
								}}
								minDate={departureDate || new Date()}
							/>
						)}
					</div>
				)}
			</div>

			<button
				className="search-button"
				onClick={handleSubmit}
				data-testid="search-flights"
			>
				Search Flights
			</button>
		</div>
	);
}

interface CalendarProps {
	selectedDate: Date | null;
	onSelectDate: (date: Date) => void;
	minDate?: Date;
}

function Calendar({ selectedDate, onSelectDate, minDate }: CalendarProps) {
	const today = new Date();
	const [currentMonth, setCurrentMonth] = useState(
		selectedDate || minDate || today
	);

	const startOfMonth = new Date(
		currentMonth.getFullYear(),
		currentMonth.getMonth(),
		1
	);
	const endOfMonth = new Date(
		currentMonth.getFullYear(),
		currentMonth.getMonth() + 1,
		0
	);

	const startDay = startOfMonth.getDay();
	const daysInMonth = endOfMonth.getDate();

	const days: (Date | null)[] = [];

	// Add empty slots for days before the month starts
	for (let i = 0; i < startDay; i++) {
		days.push(null);
	}

	// Add all days in the month
	for (let i = 1; i <= daysInMonth; i++) {
		days.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i));
	}

	const isDateDisabled = (date: Date) => {
		if (!minDate) return false;
		const dateWithoutTime = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		const minDateWithoutTime = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
		return dateWithoutTime < minDateWithoutTime;
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
		setCurrentMonth(
			new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
		);
	};

	const goToNextMonth = () => {
		setCurrentMonth(
			new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
		);
	};

	const monthYear = currentMonth.toLocaleDateString('en-US', {
		month: 'long',
		year: 'numeric',
	});

	return (
		<div className="calendar-popover">
			<div className="calendar-header">
				<button onClick={goToPreviousMonth}>&lt;</button>
				<span>{monthYear}</span>
				<button onClick={goToNextMonth}>&gt;</button>
			</div>
			<div className="calendar-grid">
				<div className="calendar-day-header">Sun</div>
				<div className="calendar-day-header">Mon</div>
				<div className="calendar-day-header">Tue</div>
				<div className="calendar-day-header">Wed</div>
				<div className="calendar-day-header">Thu</div>
				<div className="calendar-day-header">Fri</div>
				<div className="calendar-day-header">Sat</div>
				{days.map((day, index) => {
					if (!day) {
						return <div key={`empty-${index}`} className="calendar-day empty" />;
					}

					const disabled = isDateDisabled(day);
					const selected = isDateSelected(day);

					return (
						<button
							key={index}
							className={`calendar-day ${disabled ? 'disabled' : ''} ${selected ? 'selected' : ''}`}
							onClick={() => !disabled && onSelectDate(day)}
							disabled={disabled}
							data-testid={`date-${day.getDate()}`}
						>
							{day.getDate()}
						</button>
					);
				})}
			</div>
		</div>
	);
}
