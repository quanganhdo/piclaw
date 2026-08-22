import { parse, type ParserOptions } from "@babel/parser";
import { VISITOR_KEYS } from "@babel/types";
import type { File, Node, Program } from "@babel/types";

export interface ParsedTypeScriptSource {
  readonly path: string;
  readonly source: string;
  readonly file: File;
  readonly program: Program;
  readonly statements: Program["body"];
}

export function parseTypeScriptSource(path: string, source: string): ParsedTypeScriptSource {
  const plugins: NonNullable<ParserOptions["plugins"]> = ["typescript"];
  if (/\.[cm]?tsx$/i.test(path)) plugins.push("jsx");
  let file: File;
  try {
    file = parse(source, {
      sourceFilename: path,
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SyntaxError(`Failed to parse ${path}: ${message}`, { cause: error });
  }
  return Object.freeze({ path, source, file, program: file.program, statements: file.program.body });
}

export function forEachSyntaxChild(node: Node, visit: (node: Node) => void): void {
  for (const key of VISITOR_KEYS[node.type] ?? []) {
    const value = (node as unknown as Record<string, unknown>)[key];
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (child && typeof child === "object" && typeof (child as { type?: unknown }).type === "string") {
        visit(child as Node);
      }
    }
  }
}

export function walkSyntax(node: Node, visit: (node: Node) => void): void {
  visit(node);
  forEachSyntaxChild(node, (child) => walkSyntax(child, visit));
}

export function syntaxText(sourceFile: ParsedTypeScriptSource, node: Node): string {
  if (typeof node.start !== "number" || typeof node.end !== "number") return "";
  return sourceFile.source.slice(node.start, node.end);
}

export function literalString(node: Node | null | undefined): string | null {
  if (node?.type === "StringLiteral") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? null;
  }
  return null;
}

export function propertyKeyName(node: Node | null | undefined): string | null {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "StringLiteral" || node?.type === "NumericLiteral") return String(node.value);
  return null;
}

function isImportMeta(node: Node | null | undefined): boolean {
  return node?.type === "MetaProperty" && node.meta.name === "import" && node.property.name === "meta";
}

export function calledName(node: Node | null | undefined): string | null {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "MemberExpression" && !node.computed) return propertyKeyName(node.property);
  return null;
}

export function collectModuleSpecifiers(path: string, source: string): readonly string[] {
  if (path.endsWith(".json")) return Object.freeze([]);
  const sourceFile = parseTypeScriptSource(path, source);
  const output: string[] = [];
  const add = (node: Node | null | undefined): void => {
    const value = literalString(node);
    if (value !== null) output.push(value);
  };
  walkSyntax(sourceFile.program, (node) => {
    if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      add(node.source);
      return;
    }
    if (node.type === "TSImportEqualsDeclaration" && node.moduleReference.type === "TSExternalModuleReference") {
      add(node.moduleReference.expression);
      return;
    }
    if (node.type === "TSImportType") {
      add(node.source);
      return;
    }
    if (node.type === "ImportExpression") {
      add(node.source);
      return;
    }
    if (node.type !== "CallExpression" || node.arguments.length < 1) return;
    const first = node.arguments[0];
    if (first.type === "SpreadElement" || first.type === "ArgumentPlaceholder") return;
    const callee = node.callee;
    const isRequire = callee.type === "Identifier" && callee.name === "require";
    const isStaticMember = callee.type === "MemberExpression" && !callee.computed && (
      callee.object.type === "Identifier" && callee.object.name === "require" && propertyKeyName(callee.property) === "resolve"
      || callee.object.type === "Identifier" && callee.object.name === "module" && propertyKeyName(callee.property) === "require"
      || isImportMeta(callee.object) && propertyKeyName(callee.property) === "resolve"
    );
    if (isRequire || isStaticMember) add(first);
  });
  return Object.freeze(output);
}
