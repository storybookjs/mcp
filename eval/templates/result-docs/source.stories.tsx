import type { Meta, StoryObj } from '@storybook/react-vite';
import { Source } from './source';

const meta = {
	title: 'Result Docs/Source',
	component: Source,
	parameters: {
		layout: 'fullscreen',
	},
	tags: ['autodocs'],
} satisfies Meta<typeof Source>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Empty project with no source files.
 */
export const Empty: Story = {
	args: {
		files: {},
	},
};

/**
 * Single component file.
 */
export const SingleFile: Story = {
	args: {
		files: {
			'src/components/Button.tsx': `import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
}

export const Button = ({ children, variant = 'primary', onClick }: ButtonProps) => {
  return (
    <button
      className={\`button button--\${variant}\`}
      onClick={onClick}
    >
      {children}
    </button>
  );
};
`,
		},
	},
};

/**
 * Multiple component files in a typical project structure.
 */
export const MultipleFiles: Story = {
	args: {
		files: {
			'src/components/Button.tsx': `import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
}

export const Button = ({ children, variant = 'primary', onClick }: ButtonProps) => {
  return (
    <button className={\`button button--\${variant}\`} onClick={onClick}>
      {children}
    </button>
  );
};
`,
			'src/components/Input.tsx': `import React from 'react';

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'password';
}

export const Input = ({ value, onChange, placeholder, type = 'text' }: InputProps) => {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="input"
    />
  );
};
`,
			'src/components/Card.tsx': `import React from 'react';

interface CardProps {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Card = ({ title, children, footer }: CardProps) => {
  return (
    <div className="card">
      <div className="card__header">
        <h3>{title}</h3>
      </div>
      <div className="card__body">
        {children}
      </div>
      {footer && <div className="card__footer">{footer}</div>}
    </div>
  );
};
`,
			'src/utils/helpers.ts': `export const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export const debounce = <T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};
`,
		},
	},
};

/**
 * Files with CSS and JSON alongside TypeScript.
 */
export const MixedFileTypes: Story = {
	args: {
		files: {
			'src/components/Modal.tsx': `import React from 'react';
import './Modal.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal = ({ isOpen, onClose, title, children }: ModalProps) => {
  if (!isOpen) return null;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{title}</h2>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
};
`,
			'src/components/Modal.css': `.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: white;
  border-radius: 8px;
  max-width: 500px;
  width: 100%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.modal__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #eee;
}

.modal__body {
  padding: 1rem;
}
`,
			'src/config/settings.json': `{
  "theme": "light",
  "language": "en",
  "features": {
    "darkMode": true,
    "notifications": true,
    "analytics": false
  },
  "api": {
    "baseUrl": "https://api.example.com",
    "timeout": 5000
  }
}
`,
		},
	},
};

/**
 * A large component file with many lines.
 */
export const LargeFile: Story = {
	args: {
		files: {
			'src/components/FlightBooking.tsx': `import React, { useState, useCallback, useMemo } from 'react';

interface Airport {
  code: string;
  name: string;
  city: string;
}

interface Flight {
  id: string;
  departure: Airport;
  arrival: Airport;
  departureTime: Date;
  arrivalTime: Date;
  price: number;
  airline: string;
}

interface PassengerInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface FlightBookingProps {
  airports: Airport[];
  onBookFlight: (flight: Flight, passengers: PassengerInfo[]) => Promise<void>;
}

export const FlightBooking = ({ airports, onBookFlight }: FlightBookingProps) => {
  const [step, setStep] = useState<'search' | 'select' | 'passengers' | 'confirm'>('search');
  const [origin, setOrigin] = useState<string>('');
  const [destination, setDestination] = useState<string>('');
  const [departureDate, setDepartureDate] = useState<string>('');
  const [returnDate, setReturnDate] = useState<string>('');
  const [passengers, setPassengers] = useState<number>(1);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [passengerInfo, setPassengerInfo] = useState<PassengerInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!origin || !destination || !departureDate) {
      setError('Please fill in all required fields');
      return;
    }
    setIsLoading(true);
    setError(null);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsLoading(false);
    setStep('select');
  }, [origin, destination, departureDate]);

  const handleSelectFlight = useCallback((flight: Flight) => {
    setSelectedFlight(flight);
    setPassengerInfo(Array.from({ length: passengers }, () => ({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
    })));
    setStep('passengers');
  }, [passengers]);

  const handleUpdatePassenger = useCallback((index: number, field: keyof PassengerInfo, value: string) => {
    setPassengerInfo((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!selectedFlight) return;
    setIsLoading(true);
    try {
      await onBookFlight(selectedFlight, passengerInfo);
      setStep('confirm');
    } catch (err) {
      setError('Failed to book flight. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedFlight, passengerInfo, onBookFlight]);

  const totalPrice = useMemo(() => {
    if (!selectedFlight) return 0;
    return selectedFlight.price * passengers;
  }, [selectedFlight, passengers]);

  const renderSearchForm = () => (
    <div className="flight-booking__search">
      <h2>Search Flights</h2>
      <div className="flight-booking__field">
        <label>From</label>
        <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
          <option value="">Select origin</option>
          {airports.map((airport) => (
            <option key={airport.code} value={airport.code}>
              {airport.city} ({airport.code})
            </option>
          ))}
        </select>
      </div>
      <div className="flight-booking__field">
        <label>To</label>
        <select value={destination} onChange={(e) => setDestination(e.target.value)}>
          <option value="">Select destination</option>
          {airports.filter((a) => a.code !== origin).map((airport) => (
            <option key={airport.code} value={airport.code}>
              {airport.city} ({airport.code})
            </option>
          ))}
        </select>
      </div>
      <div className="flight-booking__field">
        <label>Departure Date</label>
        <input
          type="date"
          value={departureDate}
          onChange={(e) => setDepartureDate(e.target.value)}
        />
      </div>
      <div className="flight-booking__field">
        <label>Return Date (optional)</label>
        <input
          type="date"
          value={returnDate}
          onChange={(e) => setReturnDate(e.target.value)}
        />
      </div>
      <div className="flight-booking__field">
        <label>Passengers</label>
        <input
          type="number"
          min={1}
          max={9}
          value={passengers}
          onChange={(e) => setPassengers(Number(e.target.value))}
        />
      </div>
      <button onClick={handleSearch} disabled={isLoading}>
        {isLoading ? 'Searching...' : 'Search Flights'}
      </button>
    </div>
  );

  if (error) {
    return <div className="flight-booking__error">{error}</div>;
  }

  return (
    <div className="flight-booking">
      {step === 'search' && renderSearchForm()}
      {step === 'confirm' && (
        <div className="flight-booking__confirmation">
          <h2>Booking Confirmed!</h2>
          <p>Total: \${totalPrice}</p>
        </div>
      )}
    </div>
  );
};
`,
		},
	},
};

/**
 * Deeply nested file structure.
 */
export const NestedStructure: Story = {
	args: {
		files: {
			'src/components/ui/Button/Button.tsx': `import React from 'react';
import { ButtonProps } from './Button.types';
import './Button.css';

export const Button = ({ children, variant = 'primary', size = 'medium', onClick }: ButtonProps) => {
  return (
    <button className={\`btn btn--\${variant} btn--\${size}\`} onClick={onClick}>
      {children}
    </button>
  );
};
`,
			'src/components/ui/Button/Button.types.ts': `import React from 'react';

export interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'small' | 'medium' | 'large';
  onClick?: () => void;
  disabled?: boolean;
}
`,
			'src/components/ui/Button/Button.css': `.btn {
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn--primary {
  background: #007bff;
  color: white;
}

.btn--secondary {
  background: #6c757d;
  color: white;
}

.btn--small { padding: 0.25rem 0.5rem; font-size: 0.875rem; }
.btn--medium { padding: 0.5rem 1rem; font-size: 1rem; }
.btn--large { padding: 0.75rem 1.5rem; font-size: 1.125rem; }
`,
			'src/components/ui/Button/index.ts': `export { Button } from './Button';
export type { ButtonProps } from './Button.types';
`,
			'src/components/ui/index.ts': `export * from './Button';
`,
			'src/hooks/useLocalStorage.ts': `import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch {
      console.error('Failed to save to localStorage');
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}
`,
		},
	},
};

/**
 * Stories file alongside component.
 */
export const WithStoriesFile: Story = {
	args: {
		files: {
			'src/components/Badge.tsx': `import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  color?: 'success' | 'warning' | 'error' | 'info';
}

export const Badge = ({ children, color = 'info' }: BadgeProps) => {
  return <span className={\`badge badge--\${color}\`}>{children}</span>;
};
`,
			'stories/Badge.stories.tsx': `import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from '../src/components/Badge';

const meta = {
  title: 'Components/Badge',
  component: Badge,
  tags: ['autodocs'],
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    children: 'Success',
    color: 'success',
  },
};

export const Warning: Story = {
  args: {
    children: 'Warning',
    color: 'warning',
  },
};

export const Error: Story = {
  args: {
    children: 'Error',
    color: 'error',
  },
};
`,
		},
	},
};

/**
 * Showcases external imports analysis with multiple packages.
 */
export const WithManyExternalImports: Story = {
	args: {
		files: {
			'src/components/Dashboard.tsx': `import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format, parseISO, differenceInDays } from 'date-fns';
import { Button, Card, Tabs, TabPanel } from '@radix-ui/themes';
import { LineChart, BarChart, PieChart } from 'recharts';
import { z } from 'zod';
import clsx from 'clsx';

import { useAuth } from '../hooks/useAuth';
import { fetchDashboardData } from '../api/dashboard';

const dashboardSchema = z.object({
  metrics: z.array(z.object({
    name: z.string(),
    value: z.number(),
  })),
  chartData: z.array(z.unknown()),
});

export const Dashboard = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardData,
  });

  const formattedDate = useMemo(() => {
    return format(new Date(), 'MMMM d, yyyy');
  }, []);

  if (isLoading) return <div>Loading...</div>;

  return (
    <Card className={clsx('dashboard', { 'dashboard--loading': isLoading })}>
      <h1>Welcome, {user?.name}</h1>
      <p>Today is {formattedDate}</p>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabPanel value="overview">
          <LineChart data={data?.chartData} />
        </TabPanel>
        <TabPanel value="analytics">
          <BarChart data={data?.chartData} />
        </TabPanel>
      </Tabs>
    </Card>
  );
};
`,
			'src/components/Form.tsx': `import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input, Select, Button } from '@radix-ui/themes';
import { toast } from 'sonner';

import { submitForm } from '../api/forms';

const formSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(['admin', 'user', 'guest']),
});

type FormData = z.infer<typeof formSchema>;

export const Form = () => {
  const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(formSchema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      await submitForm(data);
      toast.success('Form submitted successfully!');
    } catch (error) {
      toast.error('Failed to submit form');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Controller
        name="name"
        control={control}
        render={({ field }) => <Input {...field} placeholder="Name" />}
      />
      <Controller
        name="email"
        control={control}
        render={({ field }) => <Input {...field} type="email" placeholder="Email" />}
      />
      <Button type="submit">Submit</Button>
    </form>
  );
};
`,
			'src/hooks/useAuth.ts': `import { useContext, createContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthContext {
  user: User | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContext | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    Sentry.captureMessage('useAuth called outside AuthProvider');
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
`,
		},
	},
};

/**
 * Confirms multi-line imports are counted correctly.
 * The reshaped import has 8 specifiers across multiple lines.
 * React import has 3 specifiers (React, useState, useMemo).
 * Total should be 11 specifiers from 2 packages.
 */
export const MultiLineImports: Story = {
	args: {
		files: {
			'src/components/FlightBooking.tsx': `import React, { useState, useMemo } from "react";
import {
  Autocomplete,
  Button,
  Calendar,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
  View,
  Text,
} from "reshaped";

export const FlightBooking = () => {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");

  return (
    <View>
      <Text>Flight Booking</Text>
      <Autocomplete value={origin} onChange={setOrigin} />
      <Autocomplete value={destination} onChange={setDestination} />
      <Button>Search Flights</Button>
    </View>
  );
};
`,
		},
	},
};
