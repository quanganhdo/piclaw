import { vncPaneExtension } from "../../../web/src/panes/vnc-pane.js";
const root = document.getElementById("vnc-root")!;
const pane = vncPaneExtension.mount(root, {
  path: "piclaw://vnc",
  mode: "preview",
  container: root,
});
Object.assign(window, { disposeVncFixture: () => pane.dispose?.() });
