/** Data-only syntax contract shared by bundled palettes and VS Code JSON imports.
 * VS Code semantic selectors win over TextMate scopes; more-specific scopes win,
 * and the last equally-specific TextMate rule wins. Unsupported language/modifier
 * selectors are not guessed: Piclaw's highlighter does not have semantic analysis.
 */
export const SYNTAX_ROLES = [
  "keyword",
  "operator",
  "number",
  "string",
  "regexp",
  "comment",
  "variable",
  "variable2",
  "definition",
  "function",
  "local",
  "property",
  "propertyDefinition",
  "type",
  "class",
  "namespace",
  "label",
  "macro",
  "atom",
  "bool",
  "punctuation",
  "meta",
  "link",
  "heading",
  "invalid",
  "deleted",
  "inserted",
] as const;
export type SyntaxRole = (typeof SYNTAX_ROLES)[number];
export type SyntaxPalette = Record<SyntaxRole, string>;
export interface VSCodeSyntaxTheme {
  type?: string;
  colors?: Record<string, string>;
  semanticHighlighting?: boolean;
  semanticTokenColors?: Record<
    string,
    string | { foreground?: string; fontStyle?: string }
  >;
  tokenColors?: Array<{
    scope?: string | string[];
    settings?: { foreground?: string; background?: string; fontStyle?: string };
  }>;
}
interface RoleSpec {
  semantic: string[];
  scopes: string[];
  fallback?: SyntaxRole;
}
export const SYNTAX_ROLE_SOURCES: Record<SyntaxRole, RoleSpec> = {
  keyword: {
    semantic: ["keyword", "modifier"],
    scopes: [
      "keyword.control",
      "keyword.other",
      "storage.type",
      "storage.modifier",
      "keyword",
    ],
  },
  operator: {
    semantic: ["operator"],
    scopes: ["keyword.operator", "punctuation.operator"],
  },
  number: { semantic: ["number"], scopes: ["constant.numeric"] },
  string: { semantic: ["string"], scopes: ["string.quoted", "string"] },
  regexp: {
    semantic: ["regexp"],
    scopes: ["string.regexp"],
    fallback: "string",
  },
  comment: {
    semantic: ["comment"],
    scopes: ["comment.line", "comment.block", "comment"],
  },
  variable: {
    semantic: ["variable"],
    scopes: ["variable.other.readwrite", "variable.other", "variable"],
  },
  variable2: {
    semantic: ["variable.defaultLibrary"],
    scopes: ["support.variable", "variable.language"],
    fallback: "variable",
  },
  definition: {
    semantic: ["variable.declaration", "variable"],
    scopes: ["variable.other.readwrite", "variable.other", "variable"],
    fallback: "variable",
  },
  function: {
    semantic: ["function", "method"],
    scopes: ["entity.name.function", "support.function"],
    fallback: "definition",
  },
  local: {
    semantic: ["parameter", "variable"],
    scopes: ["variable.parameter", "variable.other", "variable"],
    fallback: "variable",
  },
  property: {
    semantic: ["property"],
    scopes: [
      "variable.other.property",
      "meta.object-literal.key",
      "entity.other.attribute-name",
    ],
    fallback: "variable",
  },
  propertyDefinition: {
    semantic: ["property.declaration", "property"],
    scopes: [
      "variable.other.property",
      "meta.object-literal.key",
      "entity.other.attribute-name",
    ],
    fallback: "property",
  },
  type: {
    semantic: ["type", "typeParameter", "interface"],
    scopes: ["entity.name.type", "support.type"],
    fallback: "variable",
  },
  class: {
    semantic: ["class", "struct", "type"],
    scopes: ["entity.name.type.class", "entity.name.class", "support.class"],
    fallback: "type",
  },
  namespace: {
    semantic: ["namespace"],
    scopes: ["entity.name.namespace", "entity.name.type.namespace"],
    fallback: "type",
  },
  label: {
    semantic: ["label"],
    scopes: ["entity.name.label"],
    fallback: "variable",
  },
  macro: {
    semantic: ["macro", "decorator"],
    scopes: ["entity.name.function.preprocessor", "meta.preprocessor"],
    fallback: "function",
  },
  atom: {
    semantic: ["enumMember"],
    scopes: ["constant.language", "constant.other"],
    fallback: "number",
  },
  bool: {
    semantic: [],
    scopes: ["constant.language.boolean", "constant.language"],
    fallback: "atom",
  },
  punctuation: { semantic: [], scopes: ["punctuation"] },
  meta: {
    semantic: ["decorator"],
    scopes: ["meta.preprocessor", "meta.tag"],
    fallback: "keyword",
  },
  link: {
    semantic: [],
    scopes: ["markup.underline.link", "string.other.link"],
    fallback: "string",
  },
  heading: { semantic: [], scopes: ["markup.heading"], fallback: "keyword" },
  invalid: { semantic: [], scopes: ["invalid.illegal", "invalid"] },
  deleted: { semantic: [], scopes: ["markup.deleted"] },
  inserted: { semantic: [], scopes: ["markup.inserted"] },
};

/** Accept colour values, not arbitrary stylesheet fragments. CSS named colours are
 * deliberately left to the browser importer; bundled source uses hex/RGB only. */
export function normaliseSyntaxColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  if (/^#[0-9a-f]{3,4}$/i.test(color))
    return (
      "#" +
      [...color.slice(1)]
        .map((c) => c + c)
        .join("")
        .toLowerCase()
    );
  if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color.toLowerCase();
  if (
    /^rgba?\(\s*[\d.]+(?:\s*,\s*|\s+)[\d.]+(?:\s*,\s*|\s+)[\d.]+(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.test(
      color,
    )
  )
    return color;
  return null;
}
export function completeSyntaxPalette(
  partial: Record<string, string> | undefined,
  foreground: string,
): SyntaxPalette {
  const result = {} as SyntaxPalette;
  const resolving = new Set<SyntaxRole>();
  const role = (key: SyntaxRole): string => {
    if (result[key]) return result[key];
    if (resolving.has(key)) throw new Error("Cyclic syntax role: " + key);
    resolving.add(key);
    const fallback = SYNTAX_ROLE_SOURCES[key].fallback;
    result[key] =
      normaliseSyntaxColor(partial?.[key]) ||
      (fallback ? role(fallback) : foreground);
    resolving.delete(key);
    return result[key];
  };
  for (const key of SYNTAX_ROLES) role(key);
  return result;
}

export function resolveVSCodeSyntax(
  theme: VSCodeSyntaxTheme,
  fallbackForeground = "#e7e9ea",
) {
  const rules = Array.isArray(theme.tokenColors) ? theme.tokenColors : [];
  const defaultRule = [...rules]
    .reverse()
    .find(
      (rule) => !rule.scope && normaliseSyntaxColor(rule.settings?.foreground),
    );
  const foreground =
    normaliseSyntaxColor(theme.colors?.["editor.foreground"]) ||
    normaliseSyntaxColor(defaultRule?.settings?.foreground) ||
    normaliseSyntaxColor(theme.colors?.foreground) ||
    fallbackForeground;
  const explicit: Partial<SyntaxPalette> = {};
  const origins: Record<string, string> = {};
  for (const key of SYNTAX_ROLES) {
    const spec = SYNTAX_ROLE_SOURCES[key];
    if (theme.semanticHighlighting !== false) {
      for (const selector of spec.semantic) {
        const entry = theme.semanticTokenColors?.[selector];
        const color = normaliseSyntaxColor(
          typeof entry === "string" ? entry : entry?.foreground,
        );
        if (color) {
          explicit[key] = color;
          origins[key] = "semantic:" + selector;
          break;
        }
      }
    }
    if (explicit[key]) continue;
    let best = -1;
    for (const rule of rules) {
      const color = normaliseSyntaxColor(rule.settings?.foreground);
      if (!color) continue;
      const selectors = (
        Array.isArray(rule.scope)
          ? rule.scope
          : typeof rule.scope === "string"
            ? [rule.scope]
            : []
      )
        .flatMap((scope) => scope.split(","))
        .map((scope) => scope.trim());
      for (const selector of selectors) {
        // Language-specific, ancestor stacks, exclusions and wildcard selectors
        // cannot be represented by global UI roles; never let them win by accident.
        if (!/^[\w-]+(?:\.[\w-]+)*$/.test(selector)) continue;
        const targetIndex = spec.scopes.findIndex(
          (scope) => scope === selector || scope.startsWith(selector + "."),
        );
        if (targetIndex < 0) continue;
        const score = selector.split(".").length * 100 - targetIndex;
        if (score >= best) {
          best = score;
          explicit[key] = color;
          origins[key] = "textmate:" + selector;
        }
      }
    }
  }
  const syntax = completeSyntaxPalette(explicit, foreground);
  for (const key of SYNTAX_ROLES)
    if (!origins[key])
      origins[key] =
        "fallback:" +
        (SYNTAX_ROLE_SOURCES[key].fallback || "editor.foreground");
  return { foreground, syntax, origins };
}
