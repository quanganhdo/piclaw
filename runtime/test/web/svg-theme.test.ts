import { expect, test } from "bun:test";
import {
  readSvgPalette,
  MERMAID_THEME_COLORS,
  stripMermaidFontImports,
} from "../../web/src/ui/svg-theme";

test("fixed SVG light/dark surfaces have explicit contrast and no browser dependency", () => {
  const light = readSvgPalette("light"),
    dark = readSvgPalette("dark");
  expect(light.background).toBe("#ffffff");
  expect(light.foreground).toBe("#18212b");
  expect(dark.background).toBe("#171b22");
  expect(dark.foreground).toBe("#e6edf3");
  expect(Object.keys(light)).toEqual(Object.keys(dark));
  light.accent = "#000000";
  expect(readSvgPalette("light").accent).toBe("#0969da");
});
test("Mermaid colours reference the shared palette rather than fixed OS presets", () => {
  expect(MERMAID_THEME_COLORS.bg).toContain("--bg-primary");
  expect(MERMAID_THEME_COLORS.fg).toContain("--text-primary");
  expect(MERMAID_THEME_COLORS.accent).toContain("--accent-color");
  expect(MERMAID_THEME_COLORS.surface).toContain("--bg-secondary");
});
test("Mermaid font imports are stripped without changing local gradient references or text", () => {
  const svg =
    "<svg><style>@import url(\"https://fonts.googleapis.com/css2?family=Inter\");\n@import url('https://fonts.googleapis.com/css2?family=Mono');.a{fill:url(#paint)}</style><text>Keep colours</text></svg>";
  expect(stripMermaidFontImports(svg)).toBe(
    "<svg><style>\n.a{fill:url(#paint)}</style><text>Keep colours</text></svg>",
  );
  expect(stripMermaidFontImports("<svg><text>Untouched</text></svg>")).toBe(
    "<svg><text>Untouched</text></svg>",
  );
});
