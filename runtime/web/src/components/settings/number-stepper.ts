import { html, useCallback, useRef, useState, useEffect } from '../../vendor/preact-htm.js';

function toFiniteNumber(value, fallback) {
    if (value === '' || value === null || value === undefined) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampNumberValue(value, { min = -Infinity, max = Infinity } = {}) {
    const parsedMin = Number.isFinite(Number(min)) ? Number(min) : -Infinity;
    const parsedMax = Number.isFinite(Number(max)) ? Number(max) : Infinity;
    return Math.min(parsedMax, Math.max(parsedMin, Number(value)));
}

export function normalizeNumberValue(value, { fallback = 0, min = -Infinity, max = Infinity } = {}) {
    const next = toFiniteNumber(value, fallback);
    return clampNumberValue(next, { min, max });
}

export function stepNumberValue(value, {
    direction = 1,
    step = 1,
    fallback = 0,
    min = -Infinity,
    max = Infinity,
} = {}) {
    const base = normalizeNumberValue(value, { fallback, min, max });
    const delta = Math.abs(toFiniteNumber(step, 1)) || 1;
    const signedDirection = Number(direction) < 0 ? -1 : 1;
    return clampNumberValue(base + (signedDirection * delta), { min, max });
}

export function NumberStepper({
    value,
    min,
    max,
    step = 1,
    fallback,
    width = '80px',
    disabled = false,
    label,
    id,
    onChange,
}) {
    const effectiveFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : normalizeNumberValue(value, { fallback: 0, min, max });
    const [localValue, setLocalValue] = useState(String(value ?? effectiveFallback));
    const editingRef = useRef(false);

    // Sync from parent when not actively editing
    useEffect(() => {
        if (!editingRef.current) {
            setLocalValue(String(value ?? effectiveFallback));
        }
    }, [value, effectiveFallback]);

    const commit = useCallback((raw) => {
        editingRef.current = false;
        const normalized = normalizeNumberValue(raw, { fallback: effectiveFallback, min, max });
        setLocalValue(String(normalized));
        onChange?.(normalized);
    }, [effectiveFallback, min, max, onChange]);

    const nudge = useCallback((direction) => {
        editingRef.current = false;
        const next = stepNumberValue(value, { direction, step, fallback: effectiveFallback, min, max });
        setLocalValue(String(next));
        onChange?.(next);
    }, [effectiveFallback, max, min, onChange, step, value]);

    return html`
        <span class="settings-number-stepper">
            <button
                type="button"
                class="settings-number-step-btn"
                aria-label=${`Decrease ${label || 'value'}`}
                title=${`Decrease ${label || 'value'}`}
                disabled=${disabled}
                onClick=${() => nudge(-1)}
            >−</button>
            <input
                id=${id}
                aria-label=${label || undefined}
                aria-invalid=${editingRef.current && (localValue.trim() === '' || !Number.isFinite(Number(localValue)) || (min != null && Number(localValue) < min) || (max != null && Number(localValue) > max)) ? 'true' : undefined}
                class="settings-number-input"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                value=${localValue}
                disabled=${disabled}
                style=${`width:${width}`}
                onInput=${(e) => {
                    editingRef.current = true;
                    setLocalValue(e.target.value);
                }}
                onBlur=${(e) => commit(e.target.value)}
                onKeyDown=${(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        commit(e.target.value);
                        e.target.blur();
                    }
                }}
            />
            <button
                type="button"
                class="settings-number-step-btn"
                aria-label=${`Increase ${label || 'value'}`}
                title=${`Increase ${label || 'value'}`}
                disabled=${disabled}
                onClick=${() => nudge(1)}
            >+</button>
        </span>
    `;
}
