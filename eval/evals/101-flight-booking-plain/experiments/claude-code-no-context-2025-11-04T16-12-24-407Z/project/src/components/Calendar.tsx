interface CalendarProps {
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  minDate?: Date;
}

export function Calendar({ selectedDate, onSelectDate, minDate }: CalendarProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const currentMonth = selectedDate || today;
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const firstDayOfWeek = firstDayOfMonth.getDay();
  const daysInMonth = lastDayOfMonth.getDate();

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

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const isDateDisabled = (date: Date) => {
    if (minDate) {
      const compareDate = new Date(date);
      compareDate.setHours(0, 0, 0, 0);
      const compareMinDate = new Date(minDate);
      compareMinDate.setHours(0, 0, 0, 0);
      return compareDate < compareMinDate;
    }
    return date < today;
  };

  const isSameDay = (date1: Date | null, date2: Date) => {
    if (!date1) return false;
    return (
      date1.getDate() === date2.getDate() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getFullYear() === date2.getFullYear()
    );
  };

  const renderDays = () => {
    const days = [];

    // Empty cells for days before the first day of the month
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(
        <div
          key={`empty-${i}`}
          style={{
            width: "40px",
            height: "40px",
          }}
        />
      );
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const disabled = isDateDisabled(date);
      const selected = isSameDay(selectedDate, date);

      days.push(
        <button
          key={day}
          data-testid={`date-${day}`}
          onClick={() => !disabled && onSelectDate(date)}
          disabled={disabled}
          style={{
            width: "40px",
            height: "40px",
            border: "none",
            backgroundColor: selected ? "#007bff" : "transparent",
            color: disabled ? "#ccc" : selected ? "white" : "#333",
            cursor: disabled ? "not-allowed" : "pointer",
            borderRadius: "4px",
            fontSize: "14px",
            fontWeight: selected ? "bold" : "normal",
          }}
          onMouseEnter={(e) => {
            if (!disabled && !selected) {
              e.currentTarget.style.backgroundColor = "#f5f5f5";
            }
          }}
          onMouseLeave={(e) => {
            if (!disabled && !selected) {
              e.currentTarget.style.backgroundColor = "transparent";
            }
          }}
        >
          {day}
        </button>
      );
    }

    return days;
  };

  return (
    <div
      style={{
        padding: "16px",
        backgroundColor: "white",
        borderRadius: "4px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: "16px",
          fontSize: "16px",
          fontWeight: "bold",
        }}
      >
        {monthNames[month]} {year}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 40px)",
          gap: "4px",
          marginBottom: "8px",
        }}
      >
        {dayNames.map((day) => (
          <div
            key={day}
            style={{
              width: "40px",
              height: "30px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              fontWeight: "bold",
              color: "#666",
            }}
          >
            {day}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 40px)",
          gap: "4px",
        }}
      >
        {renderDays()}
      </div>
    </div>
  );
}
