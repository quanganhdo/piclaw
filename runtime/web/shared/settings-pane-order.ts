export interface SettingsPaneOrderKey {
  id: string;
  label: string;
}

/** Add-on settings panes use one deterministic order in every web skin. */
export function compareAddonSettingsPanes(
  left: SettingsPaneOrderKey,
  right: SettingsPaneOrderKey,
): number {
  const labelCompare = String(left.label || "").localeCompare(
    String(right.label || ""),
    undefined,
    { sensitivity: "base" },
  );
  if (labelCompare !== 0) return labelCompare;
  return String(left.id || "").localeCompare(String(right.id || ""), undefined, {
    sensitivity: "base",
  });
}
