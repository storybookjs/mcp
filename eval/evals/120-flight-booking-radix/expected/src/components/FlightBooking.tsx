import React, { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import './FlightBooking.css';

interface Airport {
	code: string;
	name: string;
}

const airports: Airport[] = [
	{ code: 'SYD', name: 'Sydney Airport, Australia' },
	{ code: 'MEL', name: 'Melbourne Airport (Tullamarine), Australia' },
	{ code: 'LAX', name: 'Los Angeles International Airport, USA' },
	{ code: 'JFK', name: 'John F. Kennedy International Airport, New York, USA' },
	{ code: 'LHR', name: 'Heathrow Airport, London, UK' },
	{ code: 'CDG', name: 'Charles de Gaulle Airport, Paris, France' },
	{
		code: 'ATL',
		name: 'Hartsfield–Jackson Atlanta International Airport, USA',
	},
	{ code: 'DXB', name: 'Dubai International Airport, UAE' },
	{ code: 'HKG', name: 'Hong Kong International Airport, Hong Kong' },
	{ code: 'BNE', name: 'Brisbane Airport, Australia' },
	{ code: 'PER', name: 'Perth Airport, Australia' },
	{ code: 'DFW', name: 'Dallas Fort Worth International Airport, USA' },
];

interface FlightBookingProps {
	onSubmit?: () => void;
}

const FlightBooking: React.FC<FlightBookingProps> = ({ onSubmit }) => {
	const [tripType, setTripType] = useState<'one-way' | 'return'>('return');
	const [fromAirport, setFromAirport] = useState<string>('');
	const [toAirport, setToAirport] = useState<string>('');
	const [departureDate, setDepartureDate] = useState<Date | null>(null);
	const [returnDate, setReturnDate] = useState<Date | null>(null);
	const [fromOpen, setFromOpen] = useState(false);
	const [toOpen, setToOpen] = useState(false);
	const [departureOpen, setDepartureOpen] = useState(false);
	const [returnOpen, setReturnOpen] = useState(false);
	const [fromSearch, setFromSearch] = useState('');
	const [toSearch, setToSearch] = useState('');

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const filteredFromAirports = airports.filter((airport) =>
		`${airport.code} ${airport.name}`
			.toLowerCase()
			.includes(fromSearch.toLowerCase()),
	);

	const filteredToAirports = airports.filter((airport) =>
		`${airport.code} ${airport.name}`
			.toLowerCase()
			.includes(toSearch.toLowerCase()),
	);

	const handleFromSelect = (airport: Airport) => {
		setFromAirport(airport.code);
		setFromOpen(false);
		setFromSearch('');
	};

	const handleToSelect = (airport: Airport) => {
		setToAirport(airport.code);
		setToOpen(false);
		setToSearch('');
	};

	const handleDepartureDateSelect = (date: Date) => {
		setDepartureDate(date);
		setDepartureOpen(false);

		// If return date is before new departure date, clear it
		if (returnDate && date > returnDate) {
			setReturnDate(null);
		}
	};

	const handleReturnDateSelect = (date: Date) => {
		setReturnDate(date);
		setReturnOpen(false);
	};

	const handleSubmit = () => {
		if (onSubmit) {
			onSubmit();
		}
	};

	const formatDate = (date: Date | null) => {
		if (!date) return '';
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		});
	};

	const getSelectedAirport = (code: string) => {
		return airports.find((a) => a.code === code);
	};

	const renderCalendar = (
		selectedDate: Date | null,
		onSelect: (date: Date) => void,
		minDate?: Date,
	) => {
		const currentDate = new Date();
		currentDate.setHours(0, 0, 0, 0);

		const displayMonth = selectedDate || currentDate;
		const year = displayMonth.getFullYear();
		const month = displayMonth.getMonth();

		const firstDay = new Date(year, month, 1);
		const lastDay = new Date(year, month + 1, 0);
		const daysInMonth = lastDay.getDate();
		const startingDayOfWeek = firstDay.getDay();

		const days = [];

		// Add empty cells for days before the first of the month
		for (let i = 0; i < startingDayOfWeek; i++) {
			days.push(<div key={`empty-${i}`} className="calendar-day empty" />);
		}

		// Add cells for each day of the month
		for (let day = 1; day <= daysInMonth; day++) {
			const date = new Date(year, month, day);
			const isPast = date < today;
			const isBeforeMin = minDate && date < minDate;
			const isDisabled = isPast || !!isBeforeMin;
			const isSelected =
				selectedDate &&
				date.getDate() === selectedDate.getDate() &&
				date.getMonth() === selectedDate.getMonth() &&
				date.getFullYear() === selectedDate.getFullYear();

			days.push(
				<button
					key={day}
					type="button"
					className={`calendar-day ${isDisabled ? 'disabled' : ''} ${isSelected ? 'selected' : ''}`}
					onClick={() => !isDisabled && onSelect(date)}
					disabled={isDisabled}
					data-testid={`date-${day}`}
				>
					{day}
				</button>,
			);
		}

		return (
			<div className="calendar">
				<div className="calendar-header">
					{displayMonth.toLocaleDateString('en-US', {
						month: 'long',
						year: 'numeric',
					})}
				</div>
				<div className="calendar-weekdays">
					{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
						<div key={day} className="calendar-weekday">
							{day}
						</div>
					))}
				</div>
				<div className="calendar-grid">{days}</div>
			</div>
		);
	};

	return (
		<div className="flight-booking">
			<h1>Book a Flight</h1>

			<div className="trip-type">
				<ToggleGroup.Root
					type="single"
					value={tripType}
					onValueChange={(value) => {
						if (value) setTripType(value as 'one-way' | 'return');
					}}
					className="toggle-group"
				>
					<ToggleGroup.Item
						value="one-way"
						className="toggle-item"
						data-testid="one-way"
					>
						One Way
					</ToggleGroup.Item>
					<ToggleGroup.Item
						value="return"
						className="toggle-item"
						data-testid="return"
					>
						Return
					</ToggleGroup.Item>
				</ToggleGroup.Root>
			</div>

			<div className="form-row">
				<div className="form-field">
					<label>From</label>
					<Popover.Root open={fromOpen} onOpenChange={setFromOpen}>
						<Popover.Trigger asChild>
							<button
								className="input-trigger"
								data-testid="flight-trigger-from"
							>
								{fromAirport
									? `${fromAirport} - ${getSelectedAirport(fromAirport)?.name}`
									: 'From'}
							</button>
						</Popover.Trigger>
						<Popover.Portal>
							<Popover.Content
								className="popover-content"
								align="start"
								sideOffset={5}
							>
								<div className="autocomplete-content">
									<input
										type="text"
										className="search-input"
										placeholder="Search airports..."
										value={fromSearch}
										onChange={(e) => setFromSearch(e.target.value)}
										autoFocus
									/>
									<div className="airport-list">
										{filteredFromAirports.map((airport) => (
											<button
												key={airport.code}
												type="button"
												className="airport-item"
												onClick={() => handleFromSelect(airport)}
												data-testid={`airport-${airport.code}`}
											>
												{airport.code} - {airport.name}
											</button>
										))}
									</div>
								</div>
							</Popover.Content>
						</Popover.Portal>
					</Popover.Root>
				</div>

				<div className="form-field">
					<label>To</label>
					<Popover.Root open={toOpen} onOpenChange={setToOpen}>
						<Popover.Trigger asChild>
							<button className="input-trigger" data-testid="flight-trigger-to">
								{toAirport
									? `${toAirport} - ${getSelectedAirport(toAirport)?.name}`
									: 'To'}
							</button>
						</Popover.Trigger>
						<Popover.Portal>
							<Popover.Content
								className="popover-content"
								align="start"
								sideOffset={5}
							>
								<div className="autocomplete-content">
									<input
										type="text"
										className="search-input"
										placeholder="Search airports..."
										value={toSearch}
										onChange={(e) => setToSearch(e.target.value)}
										autoFocus
									/>
									<div className="airport-list">
										{filteredToAirports.map((airport) => (
											<button
												key={airport.code}
												type="button"
												className="airport-item"
												onClick={() => handleToSelect(airport)}
												data-testid={`airport-${airport.code}`}
											>
												{airport.code} - {airport.name}
											</button>
										))}
									</div>
								</div>
							</Popover.Content>
						</Popover.Portal>
					</Popover.Root>
				</div>
			</div>

			<div className="form-row">
				<div className="form-field">
					<label>Departure Date</label>
					<Popover.Root open={departureOpen} onOpenChange={setDepartureOpen}>
						<Popover.Trigger asChild>
							<button
								className="input-trigger"
								data-testid="date-trigger-departure"
							>
								{departureDate ? formatDate(departureDate) : 'Departure Date'}
							</button>
						</Popover.Trigger>
						<Popover.Portal>
							<Popover.Content
								className="popover-content calendar-popover"
								align="start"
								sideOffset={5}
							>
								{renderCalendar(departureDate, handleDepartureDateSelect)}
							</Popover.Content>
						</Popover.Portal>
					</Popover.Root>
				</div>

				{tripType === 'return' && (
					<div className="form-field">
						<label>Return Date</label>
						<Popover.Root open={returnOpen} onOpenChange={setReturnOpen}>
							<Popover.Trigger asChild>
								<button
									className="input-trigger"
									data-testid="date-trigger-return"
								>
									{returnDate ? formatDate(returnDate) : 'Return Date'}
								</button>
							</Popover.Trigger>
							<Popover.Portal>
								<Popover.Content
									className="popover-content calendar-popover"
									align="start"
									sideOffset={5}
								>
									{renderCalendar(
										returnDate,
										handleReturnDateSelect,
										departureDate || today,
									)}
								</Popover.Content>
							</Popover.Portal>
						</Popover.Root>
					</div>
				)}
			</div>

			<div className="form-actions">
				<button
					type="button"
					className="submit-button"
					onClick={handleSubmit}
					data-testid="search-flights"
				>
					Search Flights
				</button>
			</div>
		</div>
	);
};

export default FlightBooking;
