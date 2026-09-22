/**
 * Shared theme metadata and markdown rendering helpers for /theme command output.
 */

import {
  WEB_THEME_PRESETS,
  WEB_THEME_ALIASES,
} from "../../../core/ui-theme-catalogue.js";
export type UiThemeMode = "light" | "dark" | "auto";
export interface UiThemePreset {
  name: string;
  label: string;
  mode: UiThemeMode;
  light?: Record<string, string>;
  dark?: Record<string, string>;
}
function preview(palette: unknown): Record<string, string> | undefined {
  if (!palette) return undefined;
  return Object.fromEntries(
    Object.entries(palette).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
export const THEME_PRESETS: UiThemePreset[] = WEB_THEME_PRESETS.map((p) => ({
  name: p.id,
  label: p.label,
  mode: p.mode,
  light: preview(p.light),
  dark: preview(p.dark),
}));
export const THEME_ALIASES = new Map<string, string>([
  ...WEB_THEME_PRESETS.map((p) => [p.id, p.id] as [string, string]),
  ...Object.entries(WEB_THEME_ALIASES),
]);

export const THEME_LIST_COLOR_KEYS = [
  "bgPrimary",
  "bgSecondary",
  "textPrimary",
  "textSecondary",
  "borderColor",
  "accent",
  "danger",
  "success",
] as const;

const FALLBACK_PALETTE: Record<(typeof THEME_LIST_COLOR_KEYS)[number], string> =
  {
    bgPrimary: "#ffffff",
    bgSecondary: "#f7f9fa",
    textPrimary: "#0f1419",
    textSecondary: "#536471",
    borderColor: "#eff3f4",
    accent: "#1d9bf0",
    danger: "#f4212e",
    success: "#00ba7c",
  };

function normalizeHex(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^#[0-9a-fA-F]{3}$/.test(raw) || /^#[0-9a-fA-F]{6}$/.test(raw))
    return raw.toLowerCase();
  return null;
}

function normalizeThemeColor(input: string): string {
  return normalizeHex(input) || input;
}

function base64(value: string): string {
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return Buffer.from(value).toString("base64");
  }
  if (typeof btoa === "function") {
    return btoa(
      encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16)),
      ),
    );
  }
  return "";
}

function makeSwatch(color: string): string {
  const safe = normalizeThemeColor(color) || "#000000";
  const size = 20;
  const radius = 3;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-hidden="true">
      <rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="${radius}" ry="${radius}" fill="${safe}" />
    </svg>
  `.trim();
  return `data:image/svg+xml;base64,${base64(svg)}`;
}

function colorCell(_label: string, color: string): string {
  return `![](${makeSwatch(color)})`;
}

function resolvePalette(preset: UiThemePreset): Record<string, string> {
  const chosen =
    preset.mode === "dark"
      ? preset.dark
      : preset.mode === "light"
        ? preset.light
        : preset.light || preset.dark;
  const merged = { ...FALLBACK_PALETTE } as Record<string, string>;
  if (!chosen) return merged;
  for (const key of THEME_LIST_COLOR_KEYS) {
    const value = chosen[key];
    if (typeof value === "string" && value.trim()) {
      merged[key] = value.trim();
    }
  }
  return merged;
}

export function normalizeTheme(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  return THEME_ALIASES.get(raw) ?? null;
}

export function labelForTheme(theme: string): string {
  return THEME_PRESETS.find((item) => item.name === theme)?.label || theme;
}

export function formatThemeList(): string {
  const header = ["| Theme | Mode | Swatches |", "| --- | --- | --- |"];

  const rows = THEME_PRESETS.map((preset) => {
    const palette = resolvePalette(preset);
    const modeLabel = preset.mode === "auto" ? "auto (light)" : preset.mode;
    const swatches = THEME_LIST_COLOR_KEYS.map((key) =>
      colorCell(key, palette[key]),
    ).join(" ");

    return [
      `| ${preset.label} (${preset.name}) `,
      `| ${modeLabel} `,
      `| ${swatches} |`,
    ].join("");
  });

  return [
    "Available themes:",
    ...header,
    ...rows,
    "",
    "Usage: /theme <name>",
    "(omit name to show this list)",
  ].join("\n");
}
