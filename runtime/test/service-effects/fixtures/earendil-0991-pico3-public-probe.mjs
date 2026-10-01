import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pico from "@earendil-works/pi-agent-core/experimental/pico3";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const root = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-agent-core/package.json")));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (manifest.version !== "0.99.1") throw new Error("Exact Pico3 target required");
const storage = new pico.MemoryStorage();
try {
  const id = storage.mintId();
  await storage.commit([{ type: "conversation", conversation: { id } }], BACKGROUND_CONTEXT);
  if ((await storage.conversation(id, BACKGROUND_CONTEXT))?.id !== id) throw new Error("Public memory roundtrip failed");
  console.log(JSON.stringify({
    version: manifest.version,
    runtime: typeof Bun === "undefined" ? `Node ${process.versions.node}` : `Bun ${Bun.version}`,
    exports: Object.keys(pico).sort(),
    memoryRoundtrip: "pass",
    executionModel: { resume: "resume" in pico.Harness.prototype, drive: "drive" in pico.Harness.prototype, permit: "permit" in pico.Harness.prototype },
    sqliteExport: "SqliteStorage" in pico,
    providerExecution: "no_provider_constructed_by_probe",
    productionActivation: false,
  }));
} finally { await storage.close(BACKGROUND_CONTEXT); }
