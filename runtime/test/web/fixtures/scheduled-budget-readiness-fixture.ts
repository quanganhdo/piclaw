// Mount the real Settings hosts/sections; the test supplies every API response.
const skin = new URLSearchParams(location.search).get("skin") || "classic";
const root = document.getElementById("app")!;

if (skin === "classic") {
  const { html, render } =
    await import("../../../web/src/vendor/preact-htm.js");
  const { requestOpenSettingsDialog } =
    await import("../../../web/src/components/settings-dialog-events.js");
  const { SettingsDialogContent } =
    await import("../../../web/src/components/settings-dialog.js");
  requestOpenSettingsDialog({ section: "scheduled-tasks" });
  render(html`<${SettingsDialogContent} onClose=${() => {}} />`, root);
} else {
  const { h, render } = await import("preact");
  const { SettingsPanel } =
    await import("../../../web/static/visual/frontend/src/panels/SettingsPanel");
  localStorage.setItem("piclaw-settings-category", "scheduled-tasks");
  render(h(SettingsPanel, {}), root);
}
