import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@earendil-works/pi-agent-core";
import * as session from "@earendil-works/pi-agent-core/harness/session";
import * as testing from "@earendil-works/pi-agent-core/harness/session/testing";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs";

const packageRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-agent-core/package.json")));
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (manifest.version !== "0.99.1") throw new Error(`Expected exact 0.99.1, got ${manifest.version}`);
const root = await mkdtemp(join(tmpdir(), "earendil-0991-public-"));
let environment;
const counts = [];
try {
  environment = new NodeExecutionEnv({ cwd: root });
  for (const backend of ["Memory", "JSONL"]) {
    let repository;
    let sequence = 0;
    const factory = async () => {
      if (repository) throw new Error("Previous repository was not closed");
      repository = backend === "Memory"
        ? new session.MemorySessionRepo({ now: () => 1_700_000_000_000 })
        : new session.JsonlSessionRepo({ fileSystem: environment, sessionsRoot: `sessions-${sequence++}`, now: () => 1_700_000_000_000 });
      if (backend === "Memory") return repository;
      const owned = repository;
      // JSONL creation requires cwd; the upstream generic catalogue omits it.
      // Match the already-admitted Piclaw public JSONL fixture mapping.
      return {
        create: (options, context) => owned.create({ ...options, cwd: root }, context),
        fork: (source, options, context) => owned.fork(source, options, context),
      };
    };
    const close = async () => {
      const previous = repository;
      repository = undefined;
      await previous?.close(BACKGROUND_CONTEXT);
    };
    const cases = testing.createSessionRepoStreamingForkConformance(factory, close);
    try {
      for (const entry of cases) await entry.run();
      counts.push({ backend, executions: cases.length, caseIds: cases.map(entry => `${entry.group} / ${entry.name}`).sort() });
    } finally { await close(); }
  }
  const ids = [...new Set(counts.flatMap(entry => entry.caseIds))].sort();
  console.log(JSON.stringify({
    version: manifest.version,
    runtime: typeof Bun === "undefined" ? `Node ${process.versions.node}` : `Bun ${Bun.version}`,
    exports: { root: Object.keys(core).sort(), session: Object.keys(session).sort(), testing: Object.keys(testing).sort() },
    rawStorageConstructors: [core, session].some(exports => "MemoryStorage" in exports || "JsonlStorage" in exports),
    streamingFork: { uniqueCases: ids.length, backendExecutions: counts.reduce((total, entry) => total + entry.executions, 0), catalogueSha256: createHash("sha256").update(JSON.stringify(ids)).digest("hex"), backends: counts },
    providerExecution: "no_provider_constructed_by_probe",
    productionActivation: false,
  }));
} finally {
  try {
    await environment?.cleanup(BACKGROUND_CONTEXT);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
