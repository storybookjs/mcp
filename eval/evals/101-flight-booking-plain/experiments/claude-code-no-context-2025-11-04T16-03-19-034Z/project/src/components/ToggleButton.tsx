interface ToggleButtonProps {
  value: boolean;
  onChange: (value: boolean) => void;
  leftLabel: string;
  rightLabel: string;
  leftTestId: string;
  rightTestId: string;
}

export function ToggleButton({
  value,
  onChange,
  leftLabel,
  rightLabel,
  leftTestId,
  rightTestId,
}: ToggleButtonProps) {
  return (
    <div className="toggle-button">
      <button
        type="button"
        className={`toggle-option ${!value ? "active" : ""}`}
        onClick={() => onChange(false)}
        data-testid={leftTestId}
      >
        {leftLabel}
      </button>
      <button
        type="button"
        className={`toggle-option ${value ? "active" : ""}`}
        onClick={() => onChange(true)}
        data-testid={rightTestId}
      >
        {rightLabel}
      </button>
    </div>
  );
}
