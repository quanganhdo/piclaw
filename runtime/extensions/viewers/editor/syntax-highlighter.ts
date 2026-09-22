import {
  classHighlighter,
  HighlightStyle,
  tags,
} from "#editor-vendor/codemirror";

// Lezer's default classHighlighter collapses function names into variable/property
// classes. Preserve that distinction for both chat snippets and the live editor.
const functionRoles = HighlightStyle.define([
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: "tok-function",
  },
]);
export const themeClassHighlighter = {
  style(
    activeTags: Parameters<typeof classHighlighter.style>[0],
  ): string | null {
    const base = classHighlighter.style(activeTags);
    const extra = functionRoles.style(activeTags);
    return [base, extra].filter(Boolean).join(" ") || null;
  },
};
