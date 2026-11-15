import { expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const agentHandlerPath = resolve(import.meta.dir, "../../../src/channels/web/handlers/agent.ts");

const legacyLifecycleModules = [
  "../runtime/process-chat-preflight-runtime.js",
  "../runtime/process-chat-streaming-runtime.js",
  "../runtime/process-chat-finalization-runtime.js",
] as const;

test("agent handler has no legacy processChat lifecycle module or import", () => {
  const source = readFileSync(agentHandlerPath, "utf8").replace(/^#![^\n]*\n/, "");
  const imports = new Bun.Transpiler({ loader: "ts" }).scanImports(source);

  for (const modulePath of legacyLifecycleModules) {
    const staticImport = imports.find(
      (entry) => entry.kind === "import-statement" && entry.path === modulePath,
    );
    expect(staticImport).toBeUndefined();

    const dynamicImport = imports.find(
      (entry) => entry.kind === "dynamic-import" && entry.path === modulePath,
    );
    expect(dynamicImport).toBeUndefined();
    expect(existsSync(resolve(agentHandlerPath, "..", modulePath.replace(/\.js$/, ".ts")))).toBe(false);
  }
});
