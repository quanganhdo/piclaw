const skin = new URLSearchParams(location.search).get("skin") || "classic";
const root = document.getElementById("app")!;
const theme = await import("../../../web/src/ui/theme.js");
const { WEB_THEME_PRESETS } =
  await import("../../../src/core/ui-theme-catalogue.js");
const { paletteVariables } =
  await import("../../../web/src/ui/theme-palette.js");
const syntaxExpectations = (await import("./theme-syntax-expectations.json"))
  .default;
const syntaxSources = (await import("./vscode-syntax-sources.json")).default;
const { SYNTAX_ROLES, resolveVSCodeSyntax } =
  await import("../../../src/core/theme-syntax.js");
const { terminalThemeFromCss } =
  await import("../../../web/src/ui/theme-terminal.js");
const { importVSCodeTheme, applyTheme, saveTheme, resetTheme, loadSavedTheme } =
  await import("../../../web/static/visual/frontend/src/utils/theme-importer");
const data = {
  uiTheme: "default",
  uiTint: null,
  themes: WEB_THEME_PRESETS.map((t) => ({
    name: t.id,
    label: t.label,
    mode: t.mode,
    colors: t.dark || t.light,
  })),
  colorKeys: [
    "bgPrimary",
    "bgSecondary",
    "textPrimary",
    "textSecondary",
    "borderColor",
    "accent",
    "danger",
    "success",
  ],
};
window.fetch = async () => Response.json(data);
Object.assign(window, {
  themeFixture: {
    ...theme,
    importVSCodeTheme,
    applyTheme,
    saveTheme,
    resetTheme,
    loadSavedTheme,
    terminalThemeFromCss,
    paletteVariables,
    presets: WEB_THEME_PRESETS,
    syntaxExpectations,
    syntaxSources,
    syntaxRoles: SYNTAX_ROLES,
    resolveVSCodeSyntax,
  },
});
if (skin === "classic") {
  const { html, render, useState } =
    await import("../../../web/src/vendor/preact-htm.js");
  const { ThemeSection } =
    await import("../../../web/src/components/settings/appearance.js");
  theme.initTheme({ skin: "classic" });
  function Fixture() {
    const [settings, setSettings] = useState(data);
    return html`<div class="settings-content">
      <${ThemeSection}
        themes=${data.themes}
        colorKeys=${data.colorKeys}
        settingsData=${settings}
        setStatus=${() => {}}
        mergeSettingsData=${(patch) => setSettings({ ...settings, ...patch })}
      />
    </div>`;
  }
  if (new URLSearchParams(location.search).get("host") === "dialog") {
    const { requestOpenSettingsDialog } =
      await import("../../../web/src/components/settings-dialog-events.js");
    const { SettingsDialogContent } =
      await import("../../../web/src/components/settings-dialog.js");
    requestOpenSettingsDialog({ section: "theme" });
    render(html`<${SettingsDialogContent} onClose=${() => {}} />`, root);
  } else render(html`<${Fixture} />`, root);
} else {
  const { h, render } = await import("preact");
  const { ThemeProvider } =
    await import("../../../web/static/visual/frontend/src/theme/ThemeProvider");
  const { AppearanceSection } =
    await import("../../../web/static/visual/frontend/src/panels/settings/AppearanceSection");
  render(
    h(ThemeProvider, {
      children: h(
        "div",
        { className: "settings-panel__content" },
        h(AppearanceSection, { data, onSaveGeneral: () => {} }),
      ),
    }),
    root,
  );
}
const { highlightCodeToHtml } =
  await import("../../../web/src/utils/code-highlighting.js");
const probes = document.createElement("div");
probes.id = "theme-probes";
probes.className = "post-content";
probes.innerHTML =
  '<p id="theme-prose">Welcome to SynthWave Full — the whole interface glows.</p><pre><code><span class="token keyword">const</span> value = <span class="token string">"fixture"</span> + <span class="token number">3</span>;</code></pre><button class="compose-send-btn">Send</button>';
const realCode = document.createElement("pre");
realCode.id = "theme-real-code";
realCode.innerHTML =
  "<code>" +
  highlightCodeToHtml(
    'async function launchNeon(city) {\n  const greeting = "Welcome to the grid";\n  const power = 84;\n  const ready = true;\n  await city.connect({ power, ready });\n  return greeting;\n}',
    "javascript",
  ) +
  "</code>";
probes.append(realCode);
document.body.append(probes);
if (new URLSearchParams(location.search).get("terminal") === "1") {
  const { h, render } = await import("preact");
  const { TerminalComponent } =
    await import("../../../web/static/visual/frontend/src/components/TerminalComponent");
  const host = document.createElement("div");
  host.id = "real-terminal";
  host.style.cssText =
    "width:600px;height:240px;position:fixed;bottom:0;left:0;z-index:100;";
  document.body.append(host);
  render(h(TerminalComponent, {}), host);
}

// Literal highlighter classes test the CSS role contract independently from the
// resolver. The mounted EditorView below also exercises real parser/class output.
const roles: Record<string, string> = {
  keyword: "tok-keyword",
  operator: "tok-operator",
  number: "tok-number",
  string: "tok-string",
  regexp: "tok-regexp",
  comment: "tok-comment",
  variable: "tok-variableName",
  variable2: "tok-variableName2",
  definition: "tok-variableName tok-definition",
  function: "tok-variableName tok-definition tok-function",
  local: "tok-variableName tok-local",
  property: "tok-propertyName",
  propertyDefinition: "tok-propertyName tok-definition",
  type: "tok-typeName",
  class: "tok-className",
  namespace: "tok-namespace",
  label: "tok-labelName",
  macro: "tok-macroName",
  atom: "tok-atom",
  bool: "tok-bool",
  punctuation: "tok-punctuation",
  meta: "tok-meta",
  link: "tok-link",
  heading: "tok-heading",
  invalid: "tok-invalid",
  deleted: "tok-deleted",
  inserted: "tok-inserted",
};
const roleSheet = document.createElement("section");
roleSheet.id = "syntax-roles";
roleSheet.innerHTML = ["post-content", "cm-editor"]
  .map(
    (scope) =>
      `<div class="${scope}"><pre class="cm-content"><code>${Object.entries(
        roles,
      )
        .map(
          ([role, classes]) =>
            `<span data-role="${role}" class="${classes}">${role}</span>`,
        )
        .join(" ")}</code></pre></div>`,
  )
  .join("");
document.body.append(roleSheet);
const { EditorState, EditorView, syntaxHighlighting, javascript } =
  await import("#editor-vendor/codemirror");
const { themeClassHighlighter } =
  await import("../../../extensions/viewers/editor/syntax-highlighter.js");
const editorHost = document.createElement("div");
editorHost.id = "syntax-editor";
editorHost.style.cssText = "margin:16px;max-width:700px;";
document.body.append(editorHost);
const documentText =
  '// Syntax identity\nconst greeting = "Welcome to the grid";\nfunction launchNeon(city) { return city.connect(84, true); }';
const editor = new EditorView({
  state: EditorState.create({
    doc: documentText,
    extensions: [
      javascript(),
      syntaxHighlighting(themeClassHighlighter),
      EditorView.editable.of(false),
    ],
  }),
  parent: editorHost,
});
Object.assign((window as any).themeFixture, {
  destroyEditor: () => editor.destroy(),
});
