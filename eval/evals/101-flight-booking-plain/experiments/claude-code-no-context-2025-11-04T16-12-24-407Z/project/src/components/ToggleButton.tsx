interface ToggleButtonProps {
  options: Array<{ value: string; label: string; testId?: string }>;
  value: string;
  onChange: (value: string) => void;
}

export function ToggleButton({ options, value, onChange }: ToggleButtonProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid #ccc",
        borderRadius: "4px",
        overflow: "hidden",
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          data-testid={option.testId}
          onClick={() => onChange(option.value)}
          style={{
            padding: "10px 20px",
            border: "none",
            backgroundColor: value === option.value ? "#007bff" : "white",
            color: value === option.value ? "white" : "#333",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: value === option.value ? "bold" : "normal",
            borderRight:
              option !== options[options.length - 1]
                ? "1px solid #ccc"
                : "none",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            if (value !== option.value) {
              e.currentTarget.style.backgroundColor = "#f5f5f5";
            }
          }}
          onMouseLeave={(e) => {
            if (value !== option.value) {
              e.currentTarget.style.backgroundColor = "white";
            }
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
