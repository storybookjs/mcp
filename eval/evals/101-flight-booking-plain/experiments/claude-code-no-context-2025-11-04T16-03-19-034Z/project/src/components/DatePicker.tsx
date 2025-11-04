import { useState, useRef, useEffect } from "react";
import { Calendar } from "./Calendar";

interface DatePickerProps {
  value: Date | null;
  onChange: (date: Date) => void;
  placeholder: string;
  testId: string;
  minDate?: Date;
}

export function DatePicker({ value, onChange, placeholder, testId, minDate }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
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

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const handleSelectDate = (date: Date) => {
    onChange(date);
    setIsOpen(false);
  };

  return (
    <div className="datepicker" ref={containerRef}>
      <button
        type="button"
        className="datepicker-trigger"
        onClick={() => setIsOpen(!isOpen)}
        data-testid={testId}
      >
        {value ? formatDate(value) : placeholder}
      </button>
      {isOpen && (
        <div className="datepicker-popover">
          <Calendar selectedDate={value} onSelectDate={handleSelectDate} minDate={minDate} />
        </div>
      )}
    </div>
  );
}
