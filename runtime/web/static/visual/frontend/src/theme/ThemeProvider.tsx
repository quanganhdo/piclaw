import { createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import { DARK_THEME, LIGHT_THEME, getSystemTheme, type Theme } from "./theme";
import {
  initTheme,
  getThemeMode,
  setThemeModePreference,
  applyThemeFromEvent,
} from "../../../../../src/ui/theme";
import { loadSavedTheme } from "../utils/theme-importer";
const ThemeContext = createContext<Theme>(DARK_THEME);
export interface ThemeControl {
  mode: "light" | "dark";
  setMode: (mode: "light" | "dark") => void;
  toggleMode: () => void;
}
const ThemeControlContext = createContext<ThemeControl>({
  mode: "dark",
  setMode: (_mode) => {},
  toggleMode: () => {},
});
export function ThemeProvider({
  children,
}: {
  children: preact.ComponentChildren;
}) {
  const [mode, setMode] = useState<"light" | "dark">(getSystemTheme());
  useEffect(() => {
    const sync = () => setMode(getThemeMode());
    const stop = initTheme({ skin: "visual" });
    loadSavedTheme();
    sync();
    window.addEventListener("piclaw-theme-change", sync);
    // Initialise from the same server preference as Classic; a custom import is a deliberate local override.
    const controller = new AbortController();
    const initialSelection = document.documentElement.dataset.colorTheme;
    const initialTint = document.documentElement.dataset.tint;
    void fetch("/agent/settings-data", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (
          data &&
          !controller.signal.aborted &&
          document.documentElement.dataset.colorTheme === initialSelection &&
          document.documentElement.dataset.tint === initialTint
        )
          applyThemeFromEvent({ theme: data.uiTheme, tint: data.uiTint });
      })
      .catch(() => false);
    return () => {
      controller.abort();
      stop();
      window.removeEventListener("piclaw-theme-change", sync);
    };
  }, []);
  const control = useMemo(
    () => ({
      mode,
      setMode: (next: "light" | "dark") => setThemeModePreference(next),
      toggleMode: () =>
        setThemeModePreference(mode === "dark" ? "light" : "dark"),
    }),
    [mode],
  );
  return (
    <ThemeControlContext.Provider value={control}>
      <ThemeContext.Provider value={mode === "dark" ? DARK_THEME : LIGHT_THEME}>
        {children}
      </ThemeContext.Provider>
    </ThemeControlContext.Provider>
  );
}
export function useTheme() {
  return useContext(ThemeContext);
}
export function useThemeControl() {
  return useContext(ThemeControlContext);
}
