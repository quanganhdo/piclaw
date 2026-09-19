import { useState, useRef } from "preact/hooks";
import { useDismissableLayer } from "../hooks/useDismissableLayer";

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  id?: string;
}

/**
 * Custom styled dropdown that respects dark theme.
 * Replaces native <select> which has browser-dependent popup styling.
 */
export function CustomSelect({ options, value, onChange, className, placeholder, id }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<Record<string, string>>({});

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label ?? placeholder ?? "Select...";

  // Pointer dismissal must not steal focus from the newly clicked control.
  useDismissableLayer({ ref, open, onDismiss: () => setOpen(false), outsideEvent: "mousedown", escape: false });

  return (
    <div className={`custom-select ${className ?? ""}`} ref={ref} onFocusOut={(event) => {
      if (open && !ref.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
    }} onKeyDown={(event) => {
      if (!open || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }}>
      <button
        type="button"
        id={id}
        className="custom-select__trigger"
        ref={triggerRef}
        onClick={() => {
          if (!open && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setDropdownStyle({
              position: 'fixed',
              top: `${rect.bottom + 4}px`,
              left: `${rect.left}px`,
              width: `${rect.width}px`,
            });
          }
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="custom-select__label">{displayLabel}</span>
        <span className="custom-select__arrow">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="custom-select__dropdown" role="listbox" style={dropdownStyle}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              className={`custom-select__option${opt.value === value ? " custom-select__option--active" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
