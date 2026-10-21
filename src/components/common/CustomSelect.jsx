import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export default function CustomSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select an option...',
  disabled = false,
  className = '',
  menuClassName = '',
  style = {},
  onOpenChange
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const closeDropdown = () => {
    setIsOpen(false);
    onOpenChange?.(false);
  };

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        closeDropdown();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeDropdown();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const selectedOption = options.find((opt) => String(opt.value) === String(value));

  return (
    <div
      ref={dropdownRef}
      className={`pipeline-custom-select-wrap ${isOpen ? 'open is-open' : ''} ${className}`}
      style={{
        ...style,
        ...(isOpen ? { zIndex: 100 } : {})
      }}
    >
      <button
        type="button"
        disabled={disabled}
        className={`pipeline-custom-select-trigger ${isOpen ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => {
              const next = !prev;
              onOpenChange?.(next);
              return next;
            });
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="pipeline-custom-select-trigger-content">
          {selectedOption ? (
            <div className="pipeline-custom-select-selected">
              <span className="pipeline-custom-select-label">
                {selectedOption.label}
              </span>
              {selectedOption.sublabel && (
                <span className="pipeline-custom-select-sublabel">
                  {selectedOption.sublabel}
                </span>
              )}
            </div>
          ) : (
            <span className="pipeline-custom-select-placeholder">{placeholder}</span>
          )}
        </div>

        <ChevronDown
          size={15}
          strokeWidth={2}
          className={`pipeline-custom-select-chevron ${isOpen ? 'open' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          className={`pipeline-custom-select-menu ${menuClassName}`}
          role="listbox"
        >
          {options.length === 0 ? (
            <div className="pipeline-custom-select-empty">No options available</div>
          ) : (
            options.map((opt) => {
              const isSelected = String(opt.value) === String(value);
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  className={`pipeline-custom-select-option ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    onChange(opt.value);
                    closeDropdown();
                  }}
                >
                  <div className="pipeline-custom-select-option-content">
                    <span className="pipeline-custom-select-option-label">
                      {opt.label}
                    </span>
                    {opt.sublabel && (
                      <span className="pipeline-custom-select-option-sublabel">
                        {opt.sublabel}
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <Check size={15} strokeWidth={2.5} className="pipeline-custom-select-check" />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
