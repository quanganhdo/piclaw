import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { createTempWorkspace } from "../helpers.js";

const dbModule = new URL("../../src/db.js", import.meta.url).pathname;
const wiringModule = new URL("../../src/runtime/wiring.js", import.meta.url).pathname;
const startupStateModule = new URL("../../src/agent-memory/startup-state.js", import.meta.url).pathname;

interface ScenarioResult {
  results: Array<{ action: string; state: { kind: string; backfillRequired: boolean } }>;
  queued: number;
  queueIds: string[];
  finalState: { kind: string; backfillRequired: boolean; missingDerivedFiles: string[] };
  marker: string | null;
}

function runScenario(
  setup: (workspace: string) => void = () => {},
  options: { messageSetup?: string; calls?: number } = {},
): { workspace: ReturnType<typeof createTempWorkspace>; result: ScenarioResult } {
  const workspace = createTempWorkspace("piclaw-dream-startup-");
  setup(workspace.workspace);
  const script = `
    import { initDatabase, storeMessage } from ${JSON.stringify(dbModule)};
    import { initializeDreamWorkspaceAtStartup } from ${JSON.stringify(wiringModule)};
    import { classifyDreamWorkspaceState, getDreamStartupMarkerPath } from ${JSON.stringify(startupStateModule)};
    import { existsSync, readFileSync } from "fs";
    initDatabase();
    ${options.messageSetup || ""}
    const queued = [];
    const queue = { enqueueTask: (id, run, lane) => queued.push({ id, run, lane }) };
    const results = [];
    for (let i = 0; i < ${options.calls ?? 1}; i += 1) {
      results.push(initializeDreamWorkspaceAtStartup(queue, {}));
    }
    const markerPath = getDreamStartupMarkerPath();
    console.log("DREAM_STARTUP_RESULT=" + JSON.stringify({
      results,
      queued: queued.length,
      queueIds: queued.map((item) => item.id),
      finalState: classifyDreamWorkspaceState(),
      marker: existsSync(markerPath) ? readFileSync(markerPath, "utf8") : null,
    }));
  `;
  const proc = Bun.spawnSync([process.execPath, "-e", script], {
    env: {
      ...process.env,
      PICLAW_WORKSPACE: workspace.workspace,
      PICLAW_STORE: workspace.store,
      PICLAW_DATA: workspace.data,
      PICLAW_DB_IN_MEMORY: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(proc.exitCode, proc.stderr.toString()).toBe(0);
  const line = proc.stdout.toString().split("\n").find((entry) => entry.startsWith("DREAM_STARTUP_RESULT="));
  expect(line).toBeDefined();
  return { workspace, result: JSON.parse(line!.slice("DREAM_STARTUP_RESULT=".length)) as ScenarioResult };
}

function writeCompleteDerivedMemory(workspace: string): void {
  const memory = join(workspace, "notes", "memory");
  mkdirSync(memory, { recursive: true });
  writeFileSync(join(memory, "MEMORY.md"), "# MEMORY.md\n", "utf8");
  writeFileSync(join(memory, "current-state.md"), "# Current Dream state\n", "utf8");
  writeFileSync(join(memory, "recent-context.md"), "# Agent-ready recent context\n", "utf8");
}

function writeDailyNote(workspace: string, complete: boolean): void {
  const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const daily = join(workspace, "notes", "daily");
  mkdirSync(daily, { recursive: true });
  const first = `${date}T10:00:00.000Z`;
  const last = `${date}T10:05:00.000Z`;
  writeFileSync(
    join(daily, `${date}.md`),
    `---\ndate: ${date}\nsummarised_until: ${complete ? last : ""}\nmessages_total: 2\nmessages_user: 1\nmessages_assistant: 1\nsession_trees: 1\nsession_chats: 1\nfirst_message: ${first}\nlast_message: ${last}\nscope_mode: all-chats\nscope_anchor: *\n---\n# ${date}\n\n## Summary\n\n${complete ? "A complete daily summary." : "<!-- NEEDS_SUMMARY -->"}\n`,
    "utf8",
  );
}

const nonDreamMessageSetup = `
  storeMessage({
    id: "established-user-message",
    chat_jid: "web:default",
    sender: "user",
    sender_name: "Rui",
    content: "Durable established workspace evidence",
    timestamp: new Date(Date.now() - 86_400_000).toISOString(),
    is_bot_message: false,
  });
`;

test("fresh empty workspace queues exactly one model-driven Dream bootstrap", () => {
  const { workspace, result } = runScenario();
  try {
    expect(result.results[0].state.kind).toBe("fresh");
    expect(result.results[0].action).toBe("bootstrap_queued");
    expect(result.queued).toBe(1);
    expect(result.queueIds[0]).toStartWith("dream-bootstrap:");
  } finally {
    workspace.cleanup();
  }
});

test("complete established workspace queues no bootstrap or recovery", () => {
  const { workspace, result } = runScenario(writeCompleteDerivedMemory);
  try {
    expect(result.results[0].state.kind).toBe("established_complete");
    expect(result.results[0].action).toBe("none");
    expect(result.queued).toBe(0);
    expect(result.marker).toContain("recovery: complete");
  } finally {
    workspace.cleanup();
  }
});

test("a durable initialization marker prevents model bootstrap after total derived-file loss", () => {
  const { workspace, result } = runScenario((root) => {
    const memory = join(root, "notes", "memory");
    mkdirSync(memory, { recursive: true });
    writeFileSync(
      join(memory, ".dream-state"),
      "version: 1\ninitialized: true\nrecovery: complete\n",
      "utf8",
    );
  });
  try {
    expect(result.results[0].state.kind).toBe("established_missing_derived");
    expect(result.results[0].action).toBe("recovered");
    expect(result.queued).toBe(0);
    expect(result.finalState.kind).toBe("established_complete");
    expect(result.finalState.backfillRequired).toBe(false);
  } finally {
    workspace.cleanup();
  }
});

test("corrupt durable evidence never falls back to a startup model request", () => {
  const { workspace, result } = runScenario((root) => {
    const memory = join(root, "notes", "memory");
    mkdirSync(memory, { recursive: true });
    writeFileSync(join(memory, ".dream-state"), "corrupt marker\n", "utf8");
  });
  try {
    expect(result.results[0].state.kind).toBe("established_missing_derived");
    expect(result.results[0].state.backfillRequired).toBe(false);
    expect(result.results[0].action).toBe("recovered_backfill_deferred");
    expect(result.queued).toBe(0);
    expect(result.marker).toContain("recovery: backfill_required");
  } finally {
    workspace.cleanup();
  }
});

test("non-Dream message history prevents model bootstrap and defers missing Daily-note consolidation", () => {
  const { workspace, result } = runScenario(undefined, { messageSetup: nonDreamMessageSetup });
  try {
    expect(result.results[0].state.kind).toBe("established_missing_derived");
    expect(result.results[0].action).toBe("recovered_backfill_deferred");
    expect(result.queued).toBe(0);
    expect(result.finalState.kind).toBe("established_complete");
    expect(result.finalState.backfillRequired).toBe(true);
    expect(result.marker).toContain("recovery: backfill_required");
    for (const file of ["MEMORY.md", "current-state.md", "recent-context.md"]) {
      expect(existsSync(join(workspace.workspace, "notes", "memory", file))).toBe(true);
    }
  } finally {
    workspace.cleanup();
  }
});

test("existing complete Daily notes deterministically recreate all derived files without queueing a model", () => {
  const { workspace, result } = runScenario((root) => writeDailyNote(root, true));
  try {
    expect(result.results[0].state.kind).toBe("established_missing_derived");
    expect(result.results[0].action).toBe("recovered");
    expect(result.queued).toBe(0);
    expect(result.finalState.kind).toBe("established_complete");
    expect(result.finalState.backfillRequired).toBe(false);
    expect(readFileSync(join(workspace.workspace, "notes", "memory", "MEMORY.md"), "utf8")).toContain("Recent daily memories");
  } finally {
    workspace.cleanup();
  }
});

test("partial derived-file loss is repaired from Daily notes and incomplete summaries remain deferred", () => {
  const { workspace, result } = runScenario((root) => {
    writeCompleteDerivedMemory(root);
    writeFileSync(join(root, "notes", "memory", "user.md"), "# User memory\n\nPreserve this durable preference.\n", "utf8");
    rmSync(join(root, "notes", "memory", "recent-context.md"));
    writeDailyNote(root, false);
  });
  try {
    expect(result.results[0].state.kind).toBe("established_missing_derived");
    expect(result.results[0].action).toBe("recovered_backfill_deferred");
    expect(result.queued).toBe(0);
    expect(result.finalState.missingDerivedFiles).toHaveLength(0);
    expect(result.finalState.backfillRequired).toBe(true);
    expect(readFileSync(join(workspace.workspace, "notes", "memory", "user.md"), "utf8"))
      .toContain("Preserve this durable preference.");
  } finally {
    workspace.cleanup();
  }
});

test("repeated startup after deterministic recovery performs no second repair or model enqueue", () => {
  const { workspace, result } = runScenario(undefined, { messageSetup: nonDreamMessageSetup, calls: 2 });
  try {
    expect(result.results.map((entry) => entry.action)).toEqual([
      "recovered_backfill_deferred",
      "deferred",
    ]);
    expect(result.queued).toBe(0);
    expect(result.marker).toContain("recovery: backfill_required");
  } finally {
    workspace.cleanup();
  }
});
