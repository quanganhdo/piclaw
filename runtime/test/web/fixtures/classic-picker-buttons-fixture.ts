import { html, render, useState } from "../../../web/src/vendor/preact-htm.js";
import { ClassicModelPicker } from "../../../web/src/components/model-picker.js";
import { pickerModels } from "./picker-models.js";
const root = document.getElementById("picker-root")!;
function Fixture() {
  const [thinking, setThinking] = useState("medium");
  const [action, setAction] = useState("none");
  return html`<div style="position:absolute;left:12px;right:12px;bottom:12px">
    <output id="picker-action">${action}</output>
    <${ClassicModelPicker}
      entries=${pickerModels}
      thinkingLevel=${thinking}
      thinkingLevels=${["low", "medium", "high"].map((id) => ({ id, label: id }))}
      onSelectThinking=${setThinking}
      onSelect=${(model) => setAction(model)}
      onTogglePin=${() => setAction("pin")}
      onCompact=${() => setAction("compact")}
      onOpenSettings=${() => setAction("settings")}
      onClose=${() => setAction("close")}
    />
  </div>`;
}
render(html`<${Fixture} />`, root);
