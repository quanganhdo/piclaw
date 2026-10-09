import { h, render } from "preact";
import { html, render as classicRender } from "../../../web/src/vendor/preact-htm.js";
import { ClassicModelPicker } from "../../../web/src/components/model-picker.js";
import { ModelPicker } from "../../../web/static/visual/frontend/src/components/model-context-bar/ModelPicker.js";
import { normalizeModelCatalogue } from "../../../web/src/ui/model-catalogue.js";

const entries = normalizeModelCatalogue({ model_options: Array.from({ length: 45 }, (_, index) => ({ id: `fixture/model-${String(index).padStart(2, "0")}`, name: `Model ${String(index).padStart(2, "0")}`, context_window: 128000, available: true })), current: "fixture/model-44" }, { pinnedKeys: Array.from({ length: 45 }, (_, index) => `fixture/model-${String(index).padStart(2, "0")}`), recentByKey: {} });
const select = (key: string) => { document.getElementById("selection")!.textContent = key; };
const props = { entries, models: entries, activeModel: "fixture/model-44", contextTokens: 100, onSelectModel: select, onSelect: (entry: any) => select(entry.key), onTogglePin: () => {}, onClose: () => {}, onDismiss: () => {}, switching: false };
if (location.search.includes("visual")) render(h(ModelPicker, props), document.getElementById("root")!);
else classicRender(html`<${ClassicModelPicker} ...${props} />`, document.getElementById("root")!);
