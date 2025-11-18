import { useState } from 'react';
import {
	AutoComplete,
	Button,
	DatePicker,
	RadioTileGroup,
	RadioTile,
	Stack,
	Form,
} from 'rsuite';
import './FlightBooking.css';

interface Airport {
	value: string;
	label: string;
}

const airports: Airport[] = [
	{ value: 'SYD', label: 'SYD – Sydney Airport, Australia' },
	{ value: 'MEL', label: 'MEL – Melbourne Airport (Tullamarine), Australia' },
	{ value: 'LAX', label: 'LAX – Los Angeles International Airport, USA' },
	{
		value: 'JFK',
		label: 'JFK – John F. Kennedy International Airport, New York, USA',
	},
	{ value: 'LHR', label: 'LHR – Heathrow Airport, London, UK' },
	{ value: 'CDG', label: 'CDG – Charles de Gaulle Airport, Paris, France' },
	{
		value: 'ATL',
		label: 'ATL – Hartsfield–Jackson Atlanta International Airport, USA',
	},
	{ value: 'DXB', label: 'DXB – Dubai International Airport, UAE' },
	{ value: 'HKG', label: 'HKG – Hong Kong International Airport, Hong Kong' },
	{ value: 'BNE', label: 'BNE – Brisbane Airport, Australia' },
	{ value: 'PER', label: 'PER – Perth Airport, Australia' },
	{ value: 'DFW', label: 'DFW – Dallas Fort Worth International Airport, USA' },
];

interface FlightBookingProps {
	onSubmit?: () => void;
}

export default function FlightBooking({ onSubmit }: FlightBookingProps) {
	const [tripType, setTripType] = useState<'one-way' | 'return'>('return');
	const [fromAirport, setFromAirport] = useState('');
	const [toAirport, setToAirport] = useState('');
	const [departureDate, setDepartureDate] = useState<Date | null>(null);
	const [returnDate, setReturnDate] = useState<Date | null>(null);

	const handleSubmit = () => {
		if (onSubmit) {
			onSubmit();
		}
	};

	const shouldDisableDate = (date: Date) => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return date < today;
	};

	const shouldDisableReturnDate = (date: Date) => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		if (date < today) {
			return true;
		}

		if (departureDate) {
			const departureDateOnly = new Date(departureDate);
			departureDateOnly.setHours(0, 0, 0, 0);
			return date <= departureDateOnly;
		}

		return false;
	};

	return (
		<div className="flight-booking">
			<Form fluid>
				<Stack direction="column" spacing={20}>
					<RadioTileGroup
						inline
						value={tripType}
						onChange={(value) => setTripType(value as 'one-way' | 'return')}
					>
						<RadioTile value="one-way" data-testid="one-way">
							One Way
						</RadioTile>
						<RadioTile value="return" data-testid="return">
							Return
						</RadioTile>
					</RadioTileGroup>

					<Stack spacing={10} wrap>
						<AutoComplete
							data={airports}
							placeholder="From"
							value={fromAirport}
							onChange={setFromAirport}
							data-testid="flight-trigger-from"
							style={{ width: 300 }}
							renderMenuItem={(label, item) => {
								const airport = item as Airport;
								return (
									<div data-testid={`airport-${airport.value}`}>
										{airport.label}
									</div>
								);
							}}
						/>

						<AutoComplete
							data={airports}
							placeholder="To"
							value={toAirport}
							onChange={setToAirport}
							data-testid="flight-trigger-to"
							style={{ width: 300 }}
							renderMenuItem={(label, item) => {
								const airport = item as Airport;
								return (
									<div data-testid={`airport-${airport.value}`}>
										{airport.label}
									</div>
								);
							}}
						/>
					</Stack>

					<Stack spacing={10} wrap>
						<DatePicker
							placeholder="Departure Date"
							value={departureDate}
							onChange={setDepartureDate}
							format="yyyy-MM-dd"
							shouldDisableDate={shouldDisableDate}
							data-testid="date-trigger-departure"
							style={{ width: 200 }}
							renderCell={(date) => {
								const day = date.getDate();
								return <div data-testid={`date-${day}`}>{day}</div>;
							}}
						/>

						{tripType === 'return' && (
							<DatePicker
								placeholder="Return Date"
								value={returnDate}
								onChange={setReturnDate}
								format="yyyy-MM-dd"
								shouldDisableDate={shouldDisableReturnDate}
								data-testid="date-trigger-return"
								style={{ width: 200 }}
								renderCell={(date) => {
									const day = date.getDate();
									return <div data-testid={`date-${day}`}>{day}</div>;
								}}
							/>
						)}
					</Stack>

					<Button
						appearance="primary"
						onClick={handleSubmit}
						data-testid="search-flights"
					>
						Search Flights
					</Button>
				</Stack>
			</Form>
		</div>
	);
}
