import { render } from "preact";

import { KeyboardSection } from "../../../web/static/visual/frontend/src/panels/settings/KeyboardSection";

function Fixture() {
  return (
    <div className="settings-panel settings-keyboard-fixture">
      <div className="settings-panel__content">
        <div className="settings-keyboard-fixture__reference" aria-hidden="true" style={{ position: "fixed", left: "-9999px" }}>
          <input className="settings-panel__input" type="text" tabIndex={-1} />
        </div>
        <KeyboardSection />
      </div>
    </div>
  );
}

render(<Fixture />, document.getElementById("visual-keyboard-settings-fixture-root")!);
