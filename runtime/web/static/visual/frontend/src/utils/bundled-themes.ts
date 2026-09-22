/** Both skins share identities and semantic palette generation; this adapter supplies the Visual picker. */
import { WEB_THEME_PRESETS } from "../../../../../../src/core/ui-theme-catalogue";
import { paletteVariables } from "../../../../../src/ui/theme-palette";
export interface BundledTheme {
  id: string;
  name: string;
  type: "light" | "dark" | "auto";
  swatches: [string, string, string, string];
  vars: Record<string, string>;
}
export const BUNDLED_THEMES: BundledTheme[] = WEB_THEME_PRESETS.filter(
  (t) => t.id !== "default",
).map((t) => {
  const p = t.dark || t.light!;
  const mode = t.dark ? "dark" : "light";
  return {
    id: t.id,
    name: t.label,
    type: t.mode,
    swatches: [p.bgPrimary, p.textPrimary, p.accent, p.bgSecondary],
    vars: paletteVariables(p, mode),
  };
});
