import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import FlightBooking from './components/FlightBooking';
import 'rsuite/dist/rsuite.min.css';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<FlightBooking />
	</StrictMode>,
);
