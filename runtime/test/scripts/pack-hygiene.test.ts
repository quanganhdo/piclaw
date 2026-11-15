import { describe, expect, test } from "bun:test";
import {
  REQUIRED_PACK_ENTRIES,
  extractPackedFiles,
  findBlockedPackEntries,
  findMissingRequiredPackEntries,
} from "../../scripts/pack-hygiene.ts";

describe("pack-hygiene", () => {
  test("extractPackedFiles parses bun pack output", () => {
    const output = [
      "packed 2.96KB package.json",
      "packed 4.27KB docs/tool-context-optimizations.md",
      "packed 1.00KB src/index.ts",
      "",
    ].join("\n");

    expect(extractPackedFiles(output)).toEqual([
      "package.json",
      "docs/tool-context-optimizations.md",
      "src/index.ts",
    ]);
  });

  test("findBlockedPackEntries flags blocked prefixes", () => {
    const files = [
      "src/index.ts",
      "test/remote/ssrf.test.ts",
      "coverage/lcov.info",
      "runtime/generated/dist/runtime.js",
      "runtime/generated/coverage/lcov.info",
    ];

    expect(findBlockedPackEntries(files)).toEqual([
      "test/remote/ssrf.test.ts",
      "coverage/lcov.info",
      "runtime/generated/dist/runtime.js",
      "runtime/generated/coverage/lcov.info",
    ]);
  });

  test("archive tooling is packaged without the retired AgentPool backend path", () => {
    expect(findBlockedPackEntries(["runtime/src/agent-pool/sqlite-session-store.ts"]))
      .toEqual(["runtime/src/agent-pool/sqlite-session-store.ts"]);
    for (const path of ["runtime/scripts/lib/sqlite-session-archive.ts", "runtime/scripts/import-jsonl-sessions.ts",
      "runtime/scripts/benchmark-sqlite-session-layouts.ts", "runtime/durable-engine/src/legacy-import-schema.ts"])
      expect(REQUIRED_PACK_ENTRIES).toContain(path);
  });

  test("findBlockedPackEntries allows runtime files", () => {
    const files = ["src/index.ts", "web/static/classic/index.html", "docs/architecture.md"];
    expect(findBlockedPackEntries(files)).toEqual([]);
  });

  test("findMissingRequiredPackEntries flags missing required runtime files", () => {
    const [firstRequired] = REQUIRED_PACK_ENTRIES;
    const files = REQUIRED_PACK_ENTRIES.filter((entry) => entry !== firstRequired);

    expect(findMissingRequiredPackEntries(files)).toEqual([firstRequired]);
  });

  test("findMissingRequiredPackEntries accepts a complete required runtime set", () => {
    expect(findMissingRequiredPackEntries([...REQUIRED_PACK_ENTRIES])).toEqual([]);
  });
});
