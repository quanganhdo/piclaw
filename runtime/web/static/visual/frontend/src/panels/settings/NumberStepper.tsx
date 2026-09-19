import { useState } from "preact/hooks";
import { type Signal } from "@preact/signals";

export function NumberStepper({ value, min, max, step, onSave, id, label }: {
  id?: string;
  label?: string;
  value: Signal<number>;
  min?: number;
  max?: number;
  step?: number;
  onSave: (v: number) => void;
}) {
  const s = step ?? 1;
  const [invalid, setInvalid] = useState(false);
  const decrement = () => {
    const next = Math.max(min ?? -Infinity, value.value - s);
    value.value = next;
    setInvalid(!Number.isFinite(next) || (min !== undefined && next < min) || (max !== undefined && next > max));
    onSave(next);
  };
  const increment = () => {
    const next = Math.min(max ?? Infinity, value.value + s);
    value.value = next;
    setInvalid(!Number.isFinite(next) || (min !== undefined && next < min) || (max !== undefined && next > max));
    onSave(next);
  };
  return (
    <div className="settings-panel__stepper">
      <button type="button" className="settings-panel__stepper-btn" aria-label={`Decrease ${label || "value"}`} onClick={decrement}>−</button>
      <input
        id={id}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className="settings-panel__stepper-value"
        type="number"
        min={min}
        max={max}
        value={value.value}
        onInput={(e) => {
          const input = e.target as HTMLInputElement;
          setInvalid(input.value === "" || !input.validity.valid);
          value.value = Number(input.value);
        }}
        onBlur={() => onSave(value.value)}
      />
      <button type="button" className="settings-panel__stepper-btn" aria-label={`Increase ${label || "value"}`} onClick={increment}>+</button>
    </div>
  );
}
