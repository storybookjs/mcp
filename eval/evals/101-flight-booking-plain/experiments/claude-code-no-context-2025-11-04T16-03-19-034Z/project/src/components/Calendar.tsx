interface CalendarProps {
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  minDate?: Date;
}

export function Calendar({ selectedDate, onSelectDate, minDate }: CalendarProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [currentMonth, setCurrentMonth] = useState(selectedDate || today);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const startDay = firstDayOfMonth.getDay();
  const daysInMonth = lastDayOfMonth.getDate();

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1));
  };

  const isDateDisabled = (date: Date) => {
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);

    if (compareDate < today) {
      return true;
    }

    if (minDate) {
      const compareMinDate = new Date(minDate);
      compareMinDate.setHours(0, 0, 0, 0);
      if (compareDate < compareMinDate) {
        return true;
      }
    }

    return false;
  };

  const isDateSelected = (date: Date) => {
    if (!selectedDate) return false;
    const compareSelected = new Date(selectedDate);
    compareSelected.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);
    return compareSelected.getTime() === compareDate.getTime();
  };

  const renderDays = () => {
    const days = [];

    for (let i = 0; i < startDay; i++) {
      days.push(<div key={`empty-${i}`} className="calendar-day empty" />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const disabled = isDateDisabled(date);
      const selected = isDateSelected(date);

      days.push(
        <button
          key={day}
          type="button"
          className={`calendar-day ${disabled ? "disabled" : ""} ${selected ? "selected" : ""}`}
          onClick={() => !disabled && onSelectDate(date)}
          disabled={disabled}
          data-testid={`date-${day}`}
        >
          {day}
        </button>
      );
    }

    return days;
  };

  return (
    <div className="calendar">
      <div className="calendar-header">
        <button type="button" className="calendar-nav" onClick={goToPreviousMonth}>
          ←
        </button>
        <div className="calendar-title">
          {monthNames[month]} {year}
        </div>
        <button type="button" className="calendar-nav" onClick={goToNextMonth}>
          →
        </button>
      </div>
      <div className="calendar-weekdays">
        {weekdays.map((day) => (
          <div key={day} className="calendar-weekday">
            {day}
          </div>
        ))}
      </div>
      <div className="calendar-days">{renderDays()}</div>
    </div>
  );
}

import { useState } from "react";
