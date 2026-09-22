/** Trusted defaults for isolated SVG images; source colours are never inverted. */
export type SvgSurface = "theme" | "light" | "dark";
export interface SvgPalette {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  border: string;
  surface: string;
  success: string;
  warning: string;
  danger: string;
}
const light: SvgPalette = {
  background: "#ffffff",
  foreground: "#18212b",
  muted: "#536171",
  accent: "#0969da",
  border: "#b6bec8",
  surface: "#f3f5f7",
  success: "#1a7f37",
  warning: "#9a6700",
  danger: "#cf222e",
};
const dark: SvgPalette = {
  background: "#171b22",
  foreground: "#e6edf3",
  muted: "#a2afbf",
  accent: "#79c0ff",
  border: "#586577",
  surface: "#242b36",
  success: "#7ee787",
  warning: "#e3b341",
  danger: "#ff7b72",
};
export function readSvgPalette(surface: SvgSurface = "theme"): SvgPalette {
  if (surface === "light") return { ...light };
  if (surface === "dark") return { ...dark };
  if (typeof document === "undefined") return { ...light };
  const root = document.documentElement;
  const mode =
    root.dataset.theme ||
    (root.classList.contains("dark")
      ? "dark"
      : root.classList.contains("light")
        ? "light"
        : typeof matchMedia === "function" &&
            matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light");
  const defaults = mode === "dark" ? dark : light;
  if (!document.body) return { ...defaults };
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.append(probe);
  try {
    const names: Record<keyof SvgPalette, string> = {
      background: "--bg-primary",
      foreground: "--text-primary",
      muted: "--text-secondary",
      accent: "--accent-color",
      border: "--border-color",
      surface: "--bg-secondary",
      success: "--success-color",
      warning: "--warning-color",
      danger: "--danger-color",
    };
    return Object.fromEntries(
      Object.entries(names).map(([key, name]) => {
        probe.style.color = `var(${name}, ${defaults[key as keyof SvgPalette]})`;
        return [key, getComputedStyle(probe).color];
      }),
    ) as unknown as SvgPalette;
  } finally {
    probe.remove();
  }
}
/** Mermaid runs as sanitized inline SVG and can reference host variables live. */
/** The vendored renderer emits Google Fonts imports even for local font names.
 * Keep diagram rendering self-contained; do not fetch external stylesheets. */
export function stripMermaidFontImports(svg: string): string {
  return svg.replace(/@import\s+url\([^)]*\);?/gi, "");
}
export const MERMAID_THEME_COLORS = Object.freeze({
  bg: "var(--bg-primary, #ffffff)",
  fg: "var(--text-primary, #18212b)",
  line: "var(--text-secondary, #536171)",
  accent: "var(--accent-color, #0969da)",
  muted: "var(--text-secondary, #536171)",
  surface: "var(--bg-secondary, #f3f5f7)",
  border: "var(--border-color, #b6bec8)",
});
