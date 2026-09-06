import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { getDataDir } from "../core/config.js";
import { getChatJid } from "../core/chat-context.js";
import { createDreamAccessGuard } from "../core/dream-access.js";
import { createUuid } from "../utils/ids.js";

function parseDreamArgs(args: string): { days: number } | { error: string } {
  const trimmed = (args || "").trim();
  if (!trimmed) return { days: 7 };
  if (trimmed === "help" || trimmed === "--help" || trimmed === "-h") {
    return { error: "Usage: /dream [days]" };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: "Usage: /dream [days]" };
  }

  return { days: parsed };
}

export const dreamMaintenance: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerCommand("dream", {
    description: "Queue an out-of-band Dream cycle that updates notes/daily and notes/memory via a dedicated temporary dream channel.",
    handler: async (args: string) => {
      createDreamAccessGuard();
      const parsed = parseDreamArgs(args);
      if ("error" in parsed) {
        pi.sendMessage({ customType: "dream", content: parsed.error, display: true });
        return;
      }

      try {
        const tasksDir = join(getDataDir(), "ipc", "tasks");
        mkdirSync(tasksDir, { recursive: true });
        const payload = {
          type: "run_dream",
          chatJid: getChatJid("web:default"),
          mode: "manual",
          days: parsed.days,
        };
        writeFileSync(join(tasksDir, `${createUuid("dream")}.json`), JSON.stringify(payload));
        pi.sendMessage({
          customType: "dream",
          content: `Dream queued in the background for the last ${parsed.days} day(s).`,
          display: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pi.sendMessage({ customType: "dream", content: `Dream failed to queue: ${message}`, display: true });
      }
    },
  });
};
