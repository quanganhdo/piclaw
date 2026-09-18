/**
 * pane-registry.ts — Registry for addon-contributed settings panes.
 *
 * Addons (client-side) can register custom panes that appear in the
 * Settings panel's nav. Each pane provides a render function.
 *
 * Ported from runtime/web/src/components/settings/pane-registry.ts.
 */

import { compareAddonSettingsPanes } from '../../../../../../shared/settings-pane-order';

export interface SettingsPaneDefinition {
    /** Unique id (used as nav key). */
    id: string;
    /** Display label in nav. */
    label: string;
    /** SVG icon (optional). */
    icon?: unknown;
    /** Component function: (props: { filter?: string }) => VNode */
    component: unknown;
    /** Whether this pane supports the header search filter. */
    searchable?: boolean;
    /** Placeholder text for the header search. */
    searchPlaceholder?: string;
    /** Fixed core-pane order. Ignored for add-on pane navigation. */
    order?: number;
    /** Internal ownership marker set by the add-on registration API. */
    source?: 'core' | 'addon';
}

const registry: SettingsPaneDefinition[] = [];

function compareSettingsPanes(left: SettingsPaneDefinition, right: SettingsPaneDefinition): number {
    const leftIsAddon = left.source === 'addon';
    const rightIsAddon = right.source === 'addon';
    if (leftIsAddon !== rightIsAddon) return leftIsAddon ? 1 : -1;
    if (leftIsAddon) return compareAddonSettingsPanes(left, right);
    const orderCompare = (left.order ?? 500) - (right.order ?? 500);
    return orderCompare || compareAddonSettingsPanes(left, right);
}

export function registerSettingsPane(def: SettingsPaneDefinition): void {
    const normalized = { ...def, source: def.source ?? 'core' } as SettingsPaneDefinition;
    const idx = registry.findIndex(p => p.id === def.id);
    if (idx >= 0) registry[idx] = normalized;
    else registry.push(normalized);
    registry.sort(compareSettingsPanes);
}

export function registerAddonSettingsPane(def: SettingsPaneDefinition): void {
    registerSettingsPane({ ...def, source: 'addon' });
}

export function unregisterSettingsPane(id: string): void {
    const idx = registry.findIndex(p => p.id === id);
    if (idx >= 0) registry.splice(idx, 1);
}

export function getRegisteredPanes(): SettingsPaneDefinition[] {
    return [...registry];
}

/** Dispatch a custom event so the settings panel knows to re-render. */
export function notifySettingsPanesChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('piclaw:settings-panes-changed'));
}
