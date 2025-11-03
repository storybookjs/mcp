import React, { useState, useRef, useEffect } from 'react';
import { Calendar } from './Calendar';

interface DatePickerProps {
  label: string;
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  minDate?: Date;
  maxDate?: Date;
}

export const DatePicker: React.FC<DatePickerProps> = ({
  label,
  selectedDate,
  onSelectDate,
  minDate,
  maxDate,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDateSelect = (date: Date) => {
    onSelectDate(date);
    setIsOpen(false);
  };

  const formatDate = (date: Date | null): string => {
    if (!date) return '';
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="datepicker-wrapper" ref={wrapperRef}>
      <label className="datepicker-label">{label}</label>
      <button
        type="button"
        className="datepicker-button"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={selectedDate ? '' : 'placeholder'}>
          {selectedDate ? formatDate(selectedDate) : 'Select date'}
        </span>
        <span className="datepicker-icon">📅</span>
      </button>
      {isOpen && (
        <div className="datepicker-popover">
          <Calendar
            selectedDate={selectedDate}
            onSelectDate={handleDateSelect}
            minDate={minDate}
            maxDate={maxDate}
          />
        </div>
      )}
    </div>
  );
};
