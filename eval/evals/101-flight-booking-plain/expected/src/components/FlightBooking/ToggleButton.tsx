import React from 'react';

interface ToggleButtonProps {
  value: 'one-way' | 'return';
  onChange: (value: 'one-way' | 'return') => void;
}

export const ToggleButton: React.FC<ToggleButtonProps> = ({ value, onChange }) => {
  return (
    <div className="toggle-button-wrapper">
      <label className="toggle-button-label">Trip Type</label>
      <div className="toggle-button-group">
        <button
          type="button"
          className={`toggle-option ${value === 'one-way' ? 'active' : ''}`}
          onClick={() => onChange('one-way')}
        >
          One Way
        </button>
        <button
          type="button"
          className={`toggle-option ${value === 'return' ? 'active' : ''}`}
          onClick={() => onChange('return')}
        >
          Return
        </button>
      </div>
    </div>
  );
};
