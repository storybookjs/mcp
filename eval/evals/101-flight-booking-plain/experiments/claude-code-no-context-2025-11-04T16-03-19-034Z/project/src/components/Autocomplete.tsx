import { useState, useRef, useEffect } from "react";
import { Airport } from "../data/airports";

interface AutocompleteProps {
  airports: Airport[];
  value: Airport | null;
  onChange: (airport: Airport | null) => void;
  placeholder: string;
  testId: string;
}

export function Autocomplete({ airports, value, onChange, placeholder, testId }: AutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredAirports = airports.filter(
    (airport) =>
      airport.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      airport.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (airport: Airport) => {
    onChange(airport);
    setIsOpen(false);
    setSearchTerm("");
  };

  return (
    <div className="autocomplete" ref={containerRef}>
      <button
        type="button"
        className="autocomplete-trigger"
        onClick={() => setIsOpen(!isOpen)}
        data-testid={testId}
      >
        {value ? `${value.code} - ${value.name}` : placeholder}
      </button>
      {isOpen && (
        <div className="autocomplete-dropdown">
          <input
            type="text"
            className="autocomplete-search"
            placeholder="Search airports..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
          <div className="autocomplete-list">
            {filteredAirports.length > 0 ? (
              filteredAirports.map((airport) => (
                <button
                  key={airport.code}
                  type="button"
                  className="autocomplete-item"
                  onClick={() => handleSelect(airport)}
                  data-testid={airport.code}
                >
                  <strong>{airport.code}</strong> - {airport.name}
                </button>
              ))
            ) : (
              <div className="autocomplete-empty">No airports found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
