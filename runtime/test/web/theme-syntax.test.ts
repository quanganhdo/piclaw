import { expect, test } from "bun:test";
import {
  resolveVSCodeSyntax,
  SYNTAX_ROLES,
  completeSyntaxPalette,
} from "../../src/core/theme-syntax.js";
import { WEB_THEME_PRESETS } from "../../src/core/ui-theme-catalogue.js";
import { paletteVariables } from "../../web/src/ui/theme-palette.js";
import expected from "./fixtures/theme-syntax-expectations.json";

test("semantic colours override TextMate, while absent semantic roles use specific scopes and last-wins ties", () => {
  const r = resolveVSCodeSyntax({
    colors: { "editor.foreground": "#dddddd" },
    semanticTokenColors: {
      keyword: "#123456",
      function: { foreground: "#abcdef" },
      "variable.readonly": "#eeeeee",
      "class:python": "#ffff00",
    },
    tokenColors: [
      { scope: "keyword", settings: { foreground: "#ff0000" } },
      {
        scope: ["string", "constant.numeric"],
        settings: { foreground: "#112233" },
      },
      { scope: "constant", settings: { foreground: "#111111" } },
      { scope: "constant.numeric", settings: { foreground: "#445566" } },
      { scope: "string", settings: { foreground: "#778899" } },
      { scope: "string.quoted, comment", settings: { foreground: "#aabbcc" } },
      { scope: "source.js string", settings: { foreground: "#ffffff" } },
      { scope: "variable", settings: { foreground: "#456789" } },
    ],
  });
  expect(r.syntax.keyword).toBe("#123456");
  expect(r.syntax.function).toBe("#abcdef");
  expect(r.syntax.number).toBe("#445566");
  expect(r.syntax.string).toBe("#aabbcc");
  expect(r.syntax.comment).toBe("#aabbcc");
  expect(r.syntax.variable).toBe("#456789");
  expect(r.origins.keyword).toBe("semantic:keyword");
  expect(r.origins.string).toBe("textmate:string.quoted");
  expect(r.syntax.class).not.toBe("#ffff00");
  expect(r.syntax.variable).not.toBe("#eeeeee");
});

test("semantic false, global defaults, alpha and fallbacks have explicit deterministic outcomes", () => {
  const r = resolveVSCodeSyntax({
    semanticHighlighting: false,
    semanticTokenColors: { string: "#ff0000" },
    tokenColors: [
      { settings: { foreground: "#123456" } },
      { scope: "string", settings: { foreground: "#abc" } },
      { scope: "comment", settings: { foreground: "#abcdef80" } },
    ],
  });
  expect(r.foreground).toBe("#123456");
  expect(r.syntax.string).toBe("#aabbcc");
  expect(r.syntax.comment).toBe("#abcdef80");
  expect(r.syntax.number).toBe("#123456");
  expect(r.origins.number).toBe("fallback:editor.foreground");
  expect(
    resolveVSCodeSyntax({
      colors: { "editor.foreground": "#fff" },
      tokenColors: [
        {
          scope: "keyword",
          settings: { foreground: "#123; } body { color:red" },
        },
      ],
    }).syntax.keyword,
  ).toBe("#ffffff");
  expect(Object.keys(completeSyntaxPalette({}, "#112233"))).toEqual([
    ...SYNTAX_ROLES,
  ]);
});

test("all named palette variants declare every syntax role, and code colours are not UI-contrast remaps", () => {
  for (const t of WEB_THEME_PRESETS)
    for (const mode of ["light", "dark"] as const) {
      const p = t[mode];
      if (!p) continue;
      expect(Object.keys(p.syntax!).sort()).toEqual([...SYNTAX_ROLES].sort());
      const vars = paletteVariables(p, mode);
      for (const key of SYNTAX_ROLES)
        expect(vars[`--syntax-${key}`]).toBe(p.syntax![key]);
      expect(vars["--text-code"]).toBe(p.codeForeground);
      expect(vars["--bg-code"]).toBe(p.codeBackground);
      const evidence = expected.find((e) => e.id === t.id && e.mode === mode);
      if (evidence) {
        expect(p.syntax).toEqual(evidence.roles);
        expect(p.codeForeground).toBe(evidence.foreground);
        expect(p.codeBackground).toBe(evidence.background);
      }
    }
});

test("Lumon preserves authored distinct blue, cyan and white semantic roles", () => {
  const p = WEB_THEME_PRESETS.find((t) => t.id === "lumon")!.dark!;
  expect(p.codeForeground).toBe("#d6e2ee");
  expect(p.syntax).toMatchObject({
    keyword: "#6fb8e3",
    string: "#6fb8e3",
    number: "#f2fcff",
    function: "#4d9ed3",
    variable: "#4d9ed3",
    local: "#4d9ed3",
    property: "#4d9ed3",
    type: "#9dcae5",
    class: "#b4e4f6",
    namespace: "#b4e4f6",
    comment: "#4a6b80",
    operator: "#d6e2ee",
    label: "#f2fcff",
  });
  expect(paletteVariables(p, "dark")["--syntax-comment"]).toBe("#4a6b80");
  expect(paletteVariables(p, "dark")["--text-secondary"]).not.toBe("#4a6b80");
});

test("bundled VS Code ports and user imports resolve the same pinned source files", async () => {
  const { default: sources } =
    await import("./fixtures/vscode-syntax-sources.json");
  for (const source of sources) {
    const theme = WEB_THEME_PRESETS.find((t) => t.id === source.id)!;
    const palette = theme.dark || theme.light!;
    const resolved = resolveVSCodeSyntax(source.theme, palette.textPrimary);
    expect(palette.syntax).toEqual(resolved.syntax);
    expect(palette.codeForeground).toBe(resolved.foreground);
  }
});
