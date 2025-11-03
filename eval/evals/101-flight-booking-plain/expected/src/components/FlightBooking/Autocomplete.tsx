import React, { useState, useRef, useEffect } from 'react';
import { Airport } from '../../data/airports';

interface AutocompleteProps {
  airports: Airport[];
  value: Airport | null;
  onChange: (airport: Airport | null) => void;
  placeholder?: string;
  label: string;
}

export const Autocomplete: React.FC<AutocompleteProps> = ({
  airports,
  value,
  onChange,
  placeholder = 'Search airports...',
  label,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [filteredAirports, setFilteredAirports] = useState<Airport[]>(airports);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      setInputValue(`${value.code} - ${value.name}`);
    } else {
      setInputValue('');
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setIsOpen(true);

    if (!value.trim()) {
      setFilteredAirports(airports);
      onChange(null);
      return;
    }

    const filtered = airports.filter(
      (airport) =>
        airport.code.toLowerCase().includes(value.toLowerCase()) ||
        airport.name.toLowerCase().includes(value.toLowerCase()) ||
        airport.country.toLowerCase().includes(value.toLowerCase())
    );
    setFilteredAirports(filtered);
    setHighlightedIndex(-1);
  };

  const handleSelectAirport = (airport: Airport) => {
    onChange(airport);
    setInputValue(`${airport.code} - ${airport.name}`);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setIsOpen(true);
        return;
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredAirports.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && filteredAirports[highlightedIndex]) {
          handleSelectAirport(filteredAirports[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  const handleFocus = () => {
    setIsOpen(true);
    if (!inputValue) {
      setFilteredAirports(airports);
    }
  };

  return (
    <div className="autocomplete-wrapper" ref={wrapperRef}>
      <label className="autocomplete-label">{label}</label>
      <input
        type="text"
        className="autocomplete-input"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      {isOpen && filteredAirports.length > 0 && (
        <ul className="autocomplete-dropdown">
          {filteredAirports.map((airport, index) => (
            <li
              key={airport.code}
              className={`autocomplete-option ${
                index === highlightedIndex ? 'highlighted' : ''
              }`}
              onClick={() => handleSelectAirport(airport)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <div className="airport-code">{airport.code}</div>
              <div className="airport-details">
                <div className="airport-name">{airport.name}</div>
                <div className="airport-country">{airport.country}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {isOpen && filteredAirports.length === 0 && inputValue && (
        <ul className="autocomplete-dropdown">
          <li className="autocomplete-option no-results">No airports found</li>
        </ul>
      )}
    </div>
  );
};
