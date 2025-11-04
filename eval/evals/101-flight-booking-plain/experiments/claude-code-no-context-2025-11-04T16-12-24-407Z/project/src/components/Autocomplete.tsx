import { useState, useRef, useEffect } from "react";
import type { Airport } from "../data/airports";

interface AutocompleteProps {
  airports: Airport[];
  value: Airport | null;
  onChange: (airport: Airport | null) => void;
  placeholder?: string;
  testId?: string;
}

export function Autocomplete({
  airports,
  value,
  onChange,
  placeholder = "Select airport",
  testId,
}: AutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredAirports = airports.filter((airport) => {
    const search = searchTerm.toLowerCase();
    return (
      airport.code.toLowerCase().includes(search) ||
      airport.name.toLowerCase().includes(search) ||
      airport.city.toLowerCase().includes(search) ||
      airport.country.toLowerCase().includes(search)
    );
  });

  const handleSelect = (airport: Airport) => {
    onChange(airport);
    setIsOpen(false);
    setSearchTerm("");
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <button
        data-testid={testId}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          padding: "10px",
          border: "1px solid #ccc",
          borderRadius: "4px",
          backgroundColor: "white",
          textAlign: "left",
          cursor: "pointer",
          fontSize: "14px",
        }}
      >
        {value ? `${value.code} - ${value.name}` : placeholder}
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "4px",
            backgroundColor: "white",
            border: "1px solid #ccc",
            borderRadius: "4px",
            maxHeight: "300px",
            overflowY: "auto",
            zIndex: 1000,
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
          }}
        >
          <div style={{ padding: "8px" }}>
            <input
              type="text"
              placeholder="Search airports..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
                fontSize: "14px",
              }}
              autoFocus
            />
          </div>

          <div>
            {filteredAirports.map((airport) => (
              <button
                key={airport.code}
                data-testid={airport.code}
                onClick={() => handleSelect(airport)}
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "none",
                  backgroundColor: "white",
                  textAlign: "left",
                  cursor: "pointer",
                  fontSize: "14px",
                  borderTop: "1px solid #f0f0f0",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#f5f5f5";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "white";
                }}
              >
                <div style={{ fontWeight: "bold" }}>{airport.code}</div>
                <div style={{ fontSize: "12px", color: "#666" }}>
                  {airport.name}, {airport.city}, {airport.country}
                </div>
              </button>
            ))}

            {filteredAirports.length === 0 && (
              <div
                style={{
                  padding: "10px",
                  textAlign: "center",
                  color: "#666",
                  fontSize: "14px",
                }}
              >
                No airports found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
