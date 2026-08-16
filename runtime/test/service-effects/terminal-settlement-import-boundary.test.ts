import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as terminalModule from "../../src/service-effects/current-piclaw/terminal-settlement-store.js";

describe("EF-S02 latent import boundary", () => {
  test("fake is independent and no production entrypoint activates EF-S02", () => {
    const root = join(import.meta.dir, "../..");
    const fakeStore = readFileSync(
      join(
        root,
        "src/service-effects/testing/fakes/fake-terminal-settlement-store.ts",
      ),
      "utf8",
    );
    const fakeNormalizer = readFileSync(
      join(
        root,
        "src/service-effects/testing/fakes/fake-terminal-settlement-request-normalizer.ts",
      ),
      "utf8",
    );
    for (const source of [fakeStore, fakeNormalizer]) {
      expect(source).not.toContain("bun:sqlite");
      expect(source).not.toContain("current-piclaw/");
    }
    expect(Object.keys(terminalModule)).not.toContain(
      "CurrentPiclawTerminalSettlementStore",
    );
    const terminalSource = readFileSync(
      join(
        root,
        "src/service-effects/current-piclaw/terminal-settlement-store.ts",
      ),
      "utf8",
    );
    expect(terminalSource).toContain("private constructor(");
    expect(terminalSource).not.toContain(
      "export class CurrentPiclawTerminalSettlementStore",
    );
    for (const relative of [
      "src/index.ts",
      "src/db/connection.ts",
      "src/channels/web/handlers/agent.ts",
      "src/channels/web/runtime/process-chat-finalization-runtime.ts",
    ]) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source).not.toContain("terminal-settlement");
      expect(source).not.toContain("TerminalSettlementStore");
    }
  });
});
