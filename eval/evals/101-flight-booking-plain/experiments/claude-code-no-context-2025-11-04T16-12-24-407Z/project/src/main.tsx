import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import FlightBooking from './components/FlightBooking'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FlightBooking />
  </StrictMode>,
)
