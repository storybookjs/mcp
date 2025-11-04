import { useState, useRef, useEffect } from "react";
import { Calendar } from "./Calendar";

interface DatePickerProps {
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  placeholder?: string;
  testId?: string;
  minDate?: Date;
}

export function DatePicker({
  selectedDate,
  onSelectDate,
  placeholder = "Select date",
  testId,
  minDate,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
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

  const formatDate = (date: Date) => {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "short",
      day: "numeric",
    };
    return date.toLocaleDateString("en-US", options);
  };

  const handleSelectDate = (date: Date) => {
    onSelectDate(date);
    setIsOpen(false);
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
        {selectedDate ? formatDate(selectedDate) : placeholder}
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: "4px",
            backgroundColor: "white",
            border: "1px solid #ccc",
            borderRadius: "4px",
            zIndex: 1000,
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
          }}
        >
          <Calendar
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
            minDate={minDate}
          />
        </div>
      )}
    </div>
  );
}
