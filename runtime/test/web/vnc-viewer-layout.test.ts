import { expect, test } from "bun:test";
import {
  installVncViewerStyles,
  vncSessionMarkup,
} from "../../web/src/panes/vnc-viewer-ui.js";

function styleFixture() {
  const styles = new Map<string, { id: string; textContent: string }>();
  const document = {
    getElementById: (id: string) => styles.get(id),
    createElement: () => ({ id: "", textContent: "" }),
    head: {
      appendChild: (style: { id: string; textContent: string }) =>
        styles.set(style.id, style),
    },
  };
  installVncViewerStyles(document as unknown as Document);
  return {
    document,
    styles,
    css: styles.get("vnc-viewer-styles")!.textContent,
  };
}

test("VNC starts with one usable column and expands by pane width, never by viewport width", () => {
  const { css } = styleFixture();
  expect(css).toContain("container:vnc-pane / inline-size");
  expect(css).toContain("grid-template-columns:minmax(0,1fr);");
  expect(css).toContain("@container vnc-pane (min-width:720px)");
  expect(css).not.toContain("@media(max-width:640px)");
  expect(css).not.toContain("minmax(250px");
  expect(css).not.toContain("column-reverse");
  expect(css).toContain(
    "box-sizing:border-box;width:100%;min-width:0;min-height:0;overflow:auto",
  );
});

test("VNC history text truncates without shrinking action controls or preventing full labels", () => {
  const { css } = styleFixture();
  expect(css).toContain("text-overflow:ellipsis;white-space:nowrap");
  expect(css).toContain("flex:0 0 32px;width:32px;height:32px");
  expect(css).toContain(".vnc-manager-toolbar{grid-column:1 / -1}");
  expect(css).toContain(".vnc-controls [data-vnc-hide]{flex:0 0 32px");
});

test("pane styles install once per document and session markup preserves readonly gates", () => {
  const { document, styles } = styleFixture();
  installVncViewerStyles(document as unknown as Document);
  expect(styles.size).toBe(1);
  const readonly = vncSessionMarkup("<target>", true);
  expect(readonly).toContain("&lt;target&gt;");
  expect(readonly).toContain("data-vnc-send-clipboard disabled");
  expect(readonly).toContain("data-vnc-session-chrome hidden");
  expect(vncSessionMarkup("Interactive", false)).not.toContain(
    "data-vnc-send-clipboard disabled",
  );
});
