/**
 * settings-pane-registry.ts — Registry for extension-contributed settings panes.
 *
 * Extensions (client-side) can register custom panes that appear in the
 * settings dialog's nav. Each pane provides a Preact render function.
 */

import { compareAddonSettingsPanes } from '../../../shared/settings-pane-order.js';

export interface SettingsPaneDefinition {
    /** Unique id (used as nav key). */
    id: string;
    /** Display label in nav. */
    label: string;
    /** SVG icon (preact html template). */
    icon: unknown;
    /** Preact component: (props: { filter?: string }) => VNode */
    component: unknown;
    /** Whether this pane supports the header search filter. */
    searchable?: boolean;
    /** Placeholder text for the header search. */
    searchPlaceholder?: string;
    /** @deprecated Accepted for compatibility; add-on panes sort by label then id. */
    order?: number;
}

const registry: SettingsPaneDefinition[] = [];

export const compareSettingsPanesAlphabetically = compareAddonSettingsPanes;

export function registerSettingsPane(def: SettingsPaneDefinition): void {
    // Replace if same id exists
    const idx = registry.findIndex(p => p.id === def.id);
    if (idx >= 0) registry[idx] = def;
    else registry.push(def);
    registry.sort(compareSettingsPanesAlphabetically);
}

export function unregisterSettingsPane(id: string): void {
    const idx = registry.findIndex(p => p.id === id);
    if (idx >= 0) registry.splice(idx, 1);
}

export function getRegisteredSettingsPanes(): SettingsPaneDefinition[] {
    return [...registry];
}

/** Dispatch a custom event so the settings dialog knows to re-render. */
export function notifySettingsPanesChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('piclaw:settings-panes-changed'));
}
