import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve(import.meta.dir, "../../src");

function staticImports(entry: string): string[] {
  const file = resolve(source, entry);
  return new Bun.Transpiler({ loader: "ts" })
    .scanImports(readFileSync(file, "utf8").replace(/^#![^\n]*\n/, ""))
    .filter((specifier) => specifier.kind === "import-statement")
    .map((specifier) => specifier.path);
}

test("native web no longer imports the retired opaque attempt classifier", () => {
  const imports = staticImports("channels/web/handlers/agent.ts");
  expect(imports).not.toContain("../../../agent-pool/recovery-classification.js");
  expect(imports).not.toContain("../../../agent-pool/automatic-recovery.js");
});
