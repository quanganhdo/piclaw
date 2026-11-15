#!/usr/bin/env bun

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

type CommandResult = {
  command: string;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  logPath: string;
};

type EvidenceAssertion = {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
};

const repoRoot = path.resolve(import.meta.dir, "..");
const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
const artifactDir = process.env.PICLAW_QUEUE_REPLAY_AUDIT_DIR
  ? path.resolve(repoRoot, process.env.PICLAW_QUEUE_REPLAY_AUDIT_DIR)
  : path.join(repoRoot, "artifacts", "queue-session-threading-replay", timestamp);
const runLogPath = path.join(artifactDir, "run.log");
const subsetAuditLogPath = path.join(artifactDir, "session-turn-subset.log");
const evidenceJsonPath = path.join(artifactDir, "db-api-evidence.json");
const summaryJsonPath = path.join(artifactDir, "summary.json");
const summaryMarkdownPath = path.join(artifactDir, "summary.md");
const followupsDir = path.join(artifactDir, "followups");
const followupsMarkdownPath = path.join(artifactDir, "followups.md");
const requiredArtifacts = [runLogPath, subsetAuditLogPath, evidenceJsonPath, summaryJsonPath, summaryMarkdownPath, followupsMarkdownPath];
const selectedCategories = [
  "queue_and_threading",
  "request_handling",
  "http_routes",
  "recovery",
  "message_writes",
  "agent_pool_branches",
  "web_queue_state",
];

await mkdir(artifactDir, { recursive: true });
await mkdir(followupsDir, { recursive: true });
await writeFile(runLogPath, "", "utf8");

await logLine(`# queue/session/threading replay audit`);
await logLine(`# artifact_dir: ${artifactDir}`);
await logLine(`# selected_categories: ${selectedCategories.join(",")}`);

const sweepStarted = Date.now();

const subsetAudit = await runCommand({
  command: `PICLAW_AUDIT_LOG_DIR=${shellQuote(artifactDir)} PICLAW_AUDIT_ONLY=${shellQuote(selectedCategories.join(","))} bash scripts/audit-session-turn-management-regression.sh`,
  cwd: repoRoot,
  logPath: subsetAuditLogPath,
  timeoutMs: 15 * 60 * 1000,
});
await logLine(`[subset_audit] exit=${subsetAudit.exitCode} duration=${subsetAudit.durationSec}s log=${subsetAudit.logPath}`);

const subsetFailedCount = parseSummaryCount(subsetAudit.stdout + "\n" + subsetAudit.stderr, "Failed");
const evidence = await collectDbApiEvidence();
await writeFile(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

const branchIsolationFailures = evidence.assertions.filter((entry) => entry.name.startsWith("branch_") && !entry.ok).length;
const replayAssertionFailures = evidence.assertions.filter((entry) => entry.name.startsWith("replay_") && !entry.ok).length;
const replayCheckFailures = subsetFailedCount + replayAssertionFailures;

const followupTicketsNeeded = replayCheckFailures > 0 || branchIsolationFailures > 0 ? 1 : 0;
let followupPaths: string[] = [];
if (followupTicketsNeeded > 0) {
  const followupPath = path.join(followupsDir, "01-queue-session-threading-replay-followup.md");
  followupPaths = [followupPath];
  await writeFile(
    followupPath,
    buildFollowupMarkdown({
      artifactDir,
      subsetAuditLogPath,
      evidenceJsonPath,
      replayCheckFailures,
      branchIsolationFailures,
      failedAssertions: evidence.assertions.filter((entry) => !entry.ok),
    }),
    "utf8",
  );
}
await writeFile(followupsMarkdownPath, buildFollowupsIndex(followupPaths), "utf8");

const targetedRuntimeSec = Number(((Date.now() - sweepStarted) / 1000).toFixed(3));
const summary = {
  createdAt: new Date().toISOString(),
  artifactDir,
  selectedCategories,
  subsetAudit: {
    command: subsetAudit.command,
    exitCode: subsetAudit.exitCode,
    durationSec: subsetAudit.durationSec,
    logPath: subsetAudit.logPath,
    summaryFailed: subsetFailedCount,
  },
  evidencePath: evidenceJsonPath,
  assertions: evidence.assertions,
  followupPaths,
  requiredArtifacts,
  requiredArtifactsPresent: [] as string[],
  metrics: {
    script_gap_count: 0,
    replay_check_failures: replayCheckFailures,
    branch_isolation_failures: branchIsolationFailures,
    db_evidence_artifacts_present: 0,
    followup_tickets_needed: followupTicketsNeeded,
    targeted_runtime_sec: targetedRuntimeSec,
  },
};

await writeFile(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await writeFile(summaryMarkdownPath, buildSummaryMarkdown(summary), "utf8");

const requiredArtifactsPresent = requiredArtifacts.filter((artifactPath) => existsSync(artifactPath));
const dbEvidenceArtifactsPresent = [evidenceJsonPath, summaryJsonPath, summaryMarkdownPath, followupsMarkdownPath].filter((artifactPath) => existsSync(artifactPath)).length;
const missingArtifactOutputs = requiredArtifacts.length - requiredArtifactsPresent.length;
const scriptGapCount = replayCheckFailures + branchIsolationFailures + missingArtifactOutputs + followupTicketsNeeded;
summary.requiredArtifactsPresent = requiredArtifactsPresent;
summary.metrics.script_gap_count = scriptGapCount;
summary.metrics.db_evidence_artifacts_present = dbEvidenceArtifactsPresent;

await writeFile(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await writeFile(summaryMarkdownPath, buildSummaryMarkdown(summary), "utf8");

console.log(`ARTIFACT_DIR ${artifactDir}`);
console.log(`SUBSET_AUDIT_LOG ${subsetAuditLogPath}`);
console.log(`DB_API_EVIDENCE ${evidenceJsonPath}`);
console.log(`SUMMARY_JSON ${summaryJsonPath}`);
console.log(`SUMMARY_MD ${summaryMarkdownPath}`);
console.log(`FOLLOWUPS_MD ${followupsMarkdownPath}`);
console.log(`METRIC replay_check_failures=${replayCheckFailures}`);
console.log(`METRIC branch_isolation_failures=${branchIsolationFailures}`);
console.log(`METRIC db_evidence_artifacts_present=${dbEvidenceArtifactsPresent}`);
console.log(`METRIC followup_tickets_needed=${followupTicketsNeeded}`);
console.log(`METRIC targeted_runtime_sec=${targetedRuntimeSec}`);

if (scriptGapCount > 0) {
  process.exit(1);
}

process.exit(0);

async function collectDbApiEvidence(): Promise<{
  workspace: string;
  dbPath: string;
  assertions: EvidenceAssertion[];
  queueState: Record<string, unknown>;
  branchesPayload: Record<string, unknown>;
  resumePending: Record<string, unknown>;
  chatBranches: Array<Record<string, unknown>>;
  chatCursors: Array<Record<string, unknown>>;
  retrySnapshots: Array<Record<string, unknown>>;
}> {
  const workspace = mkdtempSync(join(tmpdir(), "piclaw-queue-replay-audit-"));
  const storeDir = join(workspace, "store");
  const dataDir = join(workspace, "data");
  mkdirSync(storeDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(storeDir, "messages.db");

  const previousEnv: Record<string, string | undefined> = {
    PICLAW_WORKSPACE: process.env.PICLAW_WORKSPACE,
    PICLAW_STORE: process.env.PICLAW_STORE,
    PICLAW_DATA: process.env.PICLAW_DATA,
    PICLAW_DB_IN_MEMORY: process.env.PICLAW_DB_IN_MEMORY,
  };

  process.env.PICLAW_WORKSPACE = workspace;
  process.env.PICLAW_STORE = storeDir;
  process.env.PICLAW_DATA = dataDir;
  delete process.env.PICLAW_DB_IN_MEMORY;

  try {
    const db = await importFresh<any>(path.join(repoRoot, "runtime", "src", "db.ts"));
    const webMod = await importFresh<any>(path.join(repoRoot, "runtime", "src", "channels", "web.ts"));

    db.initDatabase();
    db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_branches;");

    const rootChatJid = "web:default";
    const branchChatJid = "web:default:branch:research";
    const retryChatJid = "web:default:branch:retry";

    db.storeChatMetadata(rootChatJid, new Date().toISOString(), "Web");
    const rootBranch = db.getChatBranchByChatJid(rootChatJid)
      ?? db.ensureChatBranch({ chat_jid: rootChatJid, root_chat_jid: rootChatJid, agent_name: "default" });

    db.storeChatMetadata(branchChatJid, new Date().toISOString(), "Research");
    db.ensureChatBranch({
      chat_jid: branchChatJid,
      root_chat_jid: rootChatJid,
      parent_branch_id: rootBranch?.branch_id ?? null,
      agent_name: "research",
    });

    db.storeChatMetadata(retryChatJid, new Date().toISOString(), "Retry");
    db.ensureChatBranch({
      chat_jid: retryChatJid,
      root_chat_jid: rootChatJid,
      parent_branch_id: rootBranch?.branch_id ?? null,
      agent_name: "retry",
    });

    const enqueued: Array<{ key?: string; laneKey?: string }> = [];
    const placeholderRemovals: Array<{ chatJid: string; queuedContent: string }> = [];
    const createWeb = (options?: { streamingChatJid?: string | null }) => new webMod.WebChannel({
      queue: {
        enqueue: (_task: () => Promise<void>, key?: string, laneKey?: string) => {
          enqueued.push({ key, laneKey });
        },
      },
      agentPool: {
        setSessionBinder: () => {},
        runAgent: async () => ({ status: "success", result: "ok", attachments: [] }),
        getContextUsageForChat: async () => null,
        listKnownChats: (rootChatJidArg?: string | null, options?: { includeArchived?: boolean }) =>
          db.listChatBranches(rootChatJidArg, options),
        listActiveChats: () => db.listChatBranches(rootChatJid, { includeArchived: true }),
        isStreaming: (chatJid: string) => chatJid === options?.streamingChatJid,
        queueStreamingMessage: async () => ({ queued: true }),
        removeQueuedFollowupMessage: async (chatJid: string, queuedContent: string) => {
          placeholderRemovals.push({ chatJid, queuedContent });
        },
      },
    });

    const web = createWeb();
    const defaultRowId = web.enqueueQueuedFollowupItem(rootChatJid, 0, "root queued follow-up");
    const branchRowId = web.enqueueQueuedFollowupItem(branchChatJid, 0, "branch queued follow-up");

    const defaultQueueState = await web.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(rootChatJid)}`));
    const branchQueueState = await web.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(branchChatJid)}`));
    const branchesResponse = await web.handleRequest(new Request(`http://test/agent/branches?root_chat_jid=${encodeURIComponent(rootChatJid)}&include_archived=1`));

    const defaultQueuePayload = await defaultQueueState.json();
    const branchQueuePayload = await branchQueueState.json();
    const branchesPayload = await branchesResponse.json();

    web.resumePendingChats(branchChatJid);
    const resumeKeys = enqueued.map((entry) => entry.key).filter(Boolean);

    const removeBranchResponse = await web.handleRequest(new Request("http://test/agent/queue-remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: branchChatJid, row_id: branchRowId }),
    }));
    const removeBranchPayload = await removeBranchResponse.json();
    const defaultQueueAfterRemoveResponse = await web.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(rootChatJid)}`));
    const branchQueueAfterRemoveResponse = await web.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(branchChatJid)}`));
    const defaultQueueAfterRemove = await defaultQueueAfterRemoveResponse.json();
    const branchQueueAfterRemove = await branchQueueAfterRemoveResponse.json();

    const steerBranchRowId = web.enqueueQueuedFollowupItem(branchChatJid, 0, "branch steer follow-up");
    const steerBranchResponse = await web.handleRequest(new Request("http://test/agent/queue-steer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: branchChatJid, row_id: steerBranchRowId }),
    }));
    const steerBranchPayload = await steerBranchResponse.json();
    const defaultQueueAfterSteerResponse = await web.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(rootChatJid)}`));
    const branchQueueAfterSteerResponse = await web.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(branchChatJid)}`));
    const defaultQueueAfterSteer = await defaultQueueAfterSteerResponse.json();
    const branchQueueAfterSteer = await branchQueueAfterSteerResponse.json();

    const streamingWeb = createWeb({ streamingChatJid: branchChatJid });
    const streamingBranchRowId = streamingWeb.enqueueQueuedFollowupItem(branchChatJid, 0, "branch steer while streaming");
    const streamingSteerResponse = await streamingWeb.handleRequest(new Request("http://test/agent/queue-steer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: branchChatJid, row_id: streamingBranchRowId }),
    }));
    const streamingSteerPayload = await streamingSteerResponse.json();
    const defaultQueueAfterStreamingSteerResponse = await streamingWeb.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(rootChatJid)}`));
    const branchQueueAfterStreamingSteerResponse = await streamingWeb.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(branchChatJid)}`));
    const defaultQueueAfterStreamingSteer = await defaultQueueAfterStreamingSteerResponse.json();
    const branchQueueAfterStreamingSteer = await branchQueueAfterStreamingSteerResponse.json();

    const placeholderContent = "shared placeholder queued content";
    const rootPlaceholder = web.queueFollowupPlaceholder(rootChatJid, "\u2063", 123, placeholderContent);
    const branchPlaceholder = web.queueFollowupPlaceholder(branchChatJid, "\u2063", 456, placeholderContent);
    const removeBranchPlaceholderResponse = await web.handleRequest(new Request("http://test/agent/queue-remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: branchChatJid, row_id: branchPlaceholder?.id }),
    }));
    const removeBranchPlaceholderPayload = await removeBranchPlaceholderResponse.json();
    const rootQueueAfterPlaceholderRemoveResponse = await web.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(rootChatJid)}`));
    const branchQueueAfterPlaceholderRemoveResponse = await web.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(branchChatJid)}`));
    const rootQueueAfterPlaceholderRemove = await rootQueueAfterPlaceholderRemoveResponse.json();
    const branchQueueAfterPlaceholderRemove = await branchQueueAfterPlaceholderRemoveResponse.json();

    const placeholderSteerContent = "shared placeholder steer queued content";
    const rootPlaceholderSteer = web.queueFollowupPlaceholder(rootChatJid, "\u2063", 321, placeholderSteerContent);
    const branchPlaceholderSteer = web.queueFollowupPlaceholder(branchChatJid, "\u2063", 654, placeholderSteerContent);
    const steerBranchPlaceholderResponse = await web.handleRequest(new Request("http://test/agent/queue-steer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: branchChatJid, row_id: branchPlaceholderSteer?.id }),
    }));
    const steerBranchPlaceholderPayload = await steerBranchPlaceholderResponse.json();
    const rootQueueAfterPlaceholderSteerResponse = await web.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(rootChatJid)}`));
    const branchQueueAfterPlaceholderSteerResponse = await web.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(branchChatJid)}`));
    const rootQueueAfterPlaceholderSteer = await rootQueueAfterPlaceholderSteerResponse.json();
    const branchQueueAfterPlaceholderSteer = await branchQueueAfterPlaceholderSteerResponse.json();

    const streamingPlaceholderWeb = createWeb({ streamingChatJid: branchChatJid });
    const placeholderStreamingContent = "shared placeholder streaming steer queued content";
    const rootPlaceholderStreamingSteer = streamingPlaceholderWeb.queueFollowupPlaceholder(rootChatJid, "\u2063", 777, placeholderStreamingContent);
    const branchPlaceholderStreamingSteer = streamingPlaceholderWeb.queueFollowupPlaceholder(branchChatJid, "\u2063", 888, placeholderStreamingContent);
    const streamingPlaceholderSteerResponse = await streamingPlaceholderWeb.handleRequest(new Request("http://test/agent/queue-steer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: branchChatJid, row_id: branchPlaceholderStreamingSteer?.id }),
    }));
    const streamingPlaceholderSteerPayload = await streamingPlaceholderSteerResponse.json();
    const rootQueueAfterStreamingPlaceholderSteerResponse = await streamingPlaceholderWeb.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(rootChatJid)}`));
    const branchQueueAfterStreamingPlaceholderSteerResponse = await streamingPlaceholderWeb.handleRequest(new Request(`http://test/agent/queue-state?chat_jid=${encodeURIComponent(branchChatJid)}`));
    const rootQueueAfterStreamingPlaceholderSteer = await rootQueueAfterStreamingPlaceholderSteerResponse.json();
    const branchQueueAfterStreamingPlaceholderSteer = await branchQueueAfterStreamingPlaceholderSteerResponse.json();

    const retryFirst = createWeb();
    retryFirst.enqueueQueuedFollowupItem(retryChatJid, 0, "retry queued follow-up");
    const retryStoreMessage = retryFirst.storeMessage.bind(retryFirst);
    retryFirst.storeMessage = (chatJid: string, content: string, isBot: boolean, mediaIds: number[], options?: any) => {
      if (!isBot) return null;
      return retryStoreMessage(chatJid, content, isBot, mediaIds, options);
    };
    await retryFirst.processChat(retryChatJid, "default");
    const retryAfterFirst = db.getDeferredQueuedFollowups(retryChatJid);

    const retrySecond = createWeb();
    const retryStoreMessageSecond = retrySecond.storeMessage.bind(retrySecond);
    retrySecond.storeMessage = (chatJid: string, content: string, isBot: boolean, mediaIds: number[], options?: any) => {
      if (!isBot) return null;
      return retryStoreMessageSecond(chatJid, content, isBot, mediaIds, options);
    };
    await retrySecond.processChat(retryChatJid, "default");
    const retryAfterSecond = db.getDeferredQueuedFollowups(retryChatJid);

    const chatBranches = db.getDb().prepare(`
      SELECT chat_jid, root_chat_jid, parent_branch_id, agent_name, archived_at
      FROM chat_branches
      ORDER BY root_chat_jid ASC, chat_jid ASC
    `).all() as Array<Record<string, unknown>>;
    const chatCursors = db.getDb().prepare(`
      SELECT chat_jid, cursor_ts, queued_followups_json, inflight_prev_ts, failed_ts
      FROM chat_cursors
      ORDER BY chat_jid ASC
    `).all() as Array<Record<string, unknown>>;

    const branchItems = Array.isArray((branchQueuePayload as any).items) ? (branchQueuePayload as any).items : [];
    const rootItems = Array.isArray((defaultQueuePayload as any).items) ? (defaultQueuePayload as any).items : [];
    const listedBranches = Array.isArray((branchesPayload as any).chats) ? (branchesPayload as any).chats : [];

    const assertions: EvidenceAssertion[] = [
      {
        name: "branch_queue_state_isolation",
        ok: rootItems.length === 1 && branchItems.length === 1 && rootItems[0]?.row_id === defaultRowId && branchItems[0]?.row_id === branchRowId,
        details: { rootItems, branchItems, defaultRowId, branchRowId },
      },
      {
        name: "branch_registry_includes_root_and_branch",
        ok: listedBranches.some((entry: any) => entry.chat_jid === rootChatJid) && listedBranches.some((entry: any) => entry.chat_jid === branchChatJid && entry.root_chat_jid === rootChatJid),
        details: { listedBranches },
      },
      {
        name: "branch_queue_remove_rowid_collision_isolation",
        ok:
          removeBranchResponse.status === 200 &&
          removeBranchPayload?.removed === true &&
          defaultQueueAfterRemove?.count === 1 &&
          branchQueueAfterRemove?.count === 0 &&
          Array.isArray(defaultQueueAfterRemove?.items) &&
          defaultQueueAfterRemove.items[0]?.row_id === defaultRowId,
        details: {
          defaultRowId,
          branchRowId,
          removeBranchStatus: removeBranchResponse.status,
          removeBranchPayload,
          defaultQueueAfterRemove,
          branchQueueAfterRemove,
        },
      },
      {
        name: "branch_queue_steer_rowid_collision_isolation",
        ok:
          steerBranchResponse.status === 201 &&
          steerBranchPayload?.removed === true &&
          defaultQueueAfterSteer?.count === 1 &&
          branchQueueAfterSteer?.count === 0 &&
          Array.isArray(defaultQueueAfterSteer?.items) &&
          defaultQueueAfterSteer.items[0]?.row_id === defaultRowId,
        details: {
          defaultRowId,
          steerBranchRowId,
          steerBranchStatus: steerBranchResponse.status,
          steerBranchPayload,
          defaultQueueAfterSteer,
          branchQueueAfterSteer,
        },
      },
      {
        name: "branch_queue_steer_streaming_collision_isolation",
        ok:
          streamingSteerResponse.status === 201 &&
          streamingSteerPayload?.removed === true &&
          streamingSteerPayload?.queued === "steer" &&
          defaultQueueAfterStreamingSteer?.count === 1 &&
          branchQueueAfterStreamingSteer?.count === 0 &&
          Array.isArray(defaultQueueAfterStreamingSteer?.items) &&
          defaultQueueAfterStreamingSteer.items[0]?.row_id === defaultRowId,
        details: {
          defaultRowId,
          streamingBranchRowId,
          streamingSteerStatus: streamingSteerResponse.status,
          streamingSteerPayload,
          defaultQueueAfterStreamingSteer,
          branchQueueAfterStreamingSteer,
        },
      },
      {
        name: "branch_placeholder_remove_content_collision_isolation",
        ok:
          removeBranchPlaceholderResponse.status === 200 &&
          removeBranchPlaceholderPayload?.removed === true &&
          Array.isArray(rootQueueAfterPlaceholderRemove?.items) &&
          rootQueueAfterPlaceholderRemove.items.some((item: any) => item.row_id === rootPlaceholder?.id && item.content === placeholderContent) &&
          Array.isArray(branchQueueAfterPlaceholderRemove?.items) &&
          branchQueueAfterPlaceholderRemove.items.every((item: any) => item.row_id !== branchPlaceholder?.id) &&
          placeholderRemovals.length >= 1 &&
          placeholderRemovals[0]?.chatJid === branchChatJid &&
          placeholderRemovals[0]?.queuedContent === placeholderContent,
        details: {
          rootPlaceholderId: rootPlaceholder?.id ?? null,
          branchPlaceholderId: branchPlaceholder?.id ?? null,
          removeBranchPlaceholderStatus: removeBranchPlaceholderResponse.status,
          removeBranchPlaceholderPayload,
          rootQueueAfterPlaceholderRemove,
          branchQueueAfterPlaceholderRemove,
          placeholderRemovals,
        },
      },
      {
        name: "branch_placeholder_steer_content_collision_isolation",
        ok:
          steerBranchPlaceholderResponse.status === 201 &&
          steerBranchPlaceholderPayload?.removed === true &&
          steerBranchPlaceholderPayload?.user_message?.chat_jid === branchChatJid &&
          Array.isArray(rootQueueAfterPlaceholderSteer?.items) &&
          rootQueueAfterPlaceholderSteer.items.some((item: any) => item.row_id === rootPlaceholderSteer?.id && item.content === placeholderSteerContent) &&
          Array.isArray(branchQueueAfterPlaceholderSteer?.items) &&
          branchQueueAfterPlaceholderSteer.items.every((item: any) => item.row_id !== branchPlaceholderSteer?.id) &&
          placeholderRemovals.some((entry) => entry.chatJid === branchChatJid && entry.queuedContent === placeholderSteerContent),
        details: {
          rootPlaceholderSteerId: rootPlaceholderSteer?.id ?? null,
          branchPlaceholderSteerId: branchPlaceholderSteer?.id ?? null,
          steerBranchPlaceholderStatus: steerBranchPlaceholderResponse.status,
          steerBranchPlaceholderPayload,
          rootQueueAfterPlaceholderSteer,
          branchQueueAfterPlaceholderSteer,
          placeholderRemovals,
        },
      },
      {
        name: "branch_placeholder_steer_streaming_content_collision_isolation",
        ok:
          streamingPlaceholderSteerResponse.status === 201 &&
          streamingPlaceholderSteerPayload?.removed === true &&
          streamingPlaceholderSteerPayload?.queued === "steer" &&
          streamingPlaceholderSteerPayload?.user_message?.chat_jid === branchChatJid &&
          Array.isArray(rootQueueAfterStreamingPlaceholderSteer?.items) &&
          rootQueueAfterStreamingPlaceholderSteer.items.some((item: any) => item.row_id === rootPlaceholderStreamingSteer?.id && item.content === placeholderStreamingContent) &&
          Array.isArray(branchQueueAfterStreamingPlaceholderSteer?.items) &&
          branchQueueAfterStreamingPlaceholderSteer.items.every((item: any) => item.row_id !== branchPlaceholderStreamingSteer?.id) &&
          placeholderRemovals.some((entry) => entry.chatJid === branchChatJid && entry.queuedContent === placeholderStreamingContent),
        details: {
          rootPlaceholderStreamingSteerId: rootPlaceholderStreamingSteer?.id ?? null,
          branchPlaceholderStreamingSteerId: branchPlaceholderStreamingSteer?.id ?? null,
          streamingPlaceholderSteerStatus: streamingPlaceholderSteerResponse.status,
          streamingPlaceholderSteerPayload,
          rootQueueAfterStreamingPlaceholderSteer,
          branchQueueAfterStreamingPlaceholderSteer,
          placeholderRemovals,
        },
      },
      {
        name: "branch_resume_pending_explicit_scope_isolation",
        ok: resumeKeys.length === 1 && resumeKeys[0] === `resume:${branchChatJid}`,
        details: { resumeKeys },
      },
      {
        name: "replay_retry_persistence_survives_restart",
        ok: retryAfterFirst[0]?.materializeRetries === 1 && retryAfterSecond[0]?.materializeRetries === 2,
        details: { retryAfterFirst, retryAfterSecond },
      },
    ];

    return {
      workspace,
      dbPath,
      assertions,
      queueState: {
        [rootChatJid]: defaultQueuePayload,
        [branchChatJid]: branchQueuePayload,
      },
      branchesPayload,
      resumePending: {
        requestedChatJid: branchChatJid,
        enqueuedKeys: resumeKeys,
      },
      chatBranches,
      chatCursors,
      retrySnapshots: [
        { attempt: 1, items: retryAfterFirst },
        { attempt: 2, items: retryAfterSecond },
      ],
    };
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function runCommand(input: { command: string; cwd: string; logPath: string; timeoutMs: number }): Promise<CommandResult> {
  const startedAt = new Date();
  const proc = Bun.spawn(["bash", "-lc", input.command], {
    cwd: input.cwd,
    env: {
      ...process.env,
      TZ: process.env.TZ ?? "UTC",
      LANG: process.env.LANG ?? "C.UTF-8",
      LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
      CI: process.env.CI ?? "1",
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => {
    try {
      proc.kill("SIGTERM");
    } catch {
      // ignore
    }
  }, input.timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timeout);

  const finishedAt = new Date();
  const durationSec = Number(((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(3));
  const combined = [
    `# command: ${input.command}`,
    `# cwd: ${input.cwd}`,
    `# started_at: ${startedAt.toISOString()}`,
    `# finished_at: ${finishedAt.toISOString()}`,
    `# duration_sec: ${durationSec}`,
    `# exit_code: ${exitCode}`,
    "",
    "## stdout",
    stdout.trimEnd(),
    "",
    "## stderr",
    stderr.trimEnd(),
    "",
  ].join("\n");
  await writeFile(input.logPath, combined, "utf8");

  return {
    command: input.command,
    cwd: input.cwd,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSec,
    exitCode,
    stdout,
    stderr,
    logPath: input.logPath,
  };
}

function parseSummaryCount(text: string, label: string): number {
  const match = text.match(new RegExp(`^\\[SUMMARY\\] ${label}: (\\d+)`, "m"));
  return match ? Number(match[1]) : 1;
}

async function importFresh<T = any>(absoluteModulePath: string): Promise<T> {
  const url = new URL(`file://${absoluteModulePath}`);
  url.searchParams.set("t", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return import(url.href) as Promise<T>;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function logLine(line: string): Promise<void> {
  await appendFile(runLogPath, `${line}\n`, "utf8");
}

function buildSummaryMarkdown(summary: any): string {
  const lines: string[] = [];
  lines.push(`# Queue/session/threading replay audit`);
  lines.push("");
  lines.push(`- Artifact dir: \`${summary.artifactDir}\``);
  lines.push(`- Selected categories: ${summary.selectedCategories.map((entry: string) => `\`${entry}\``).join(", ")}`);
  lines.push(`- Subset audit log: \`${summary.subsetAudit.logPath}\``);
  lines.push(`- DB/API evidence: \`${summary.evidencePath}\``);
  lines.push("");
  lines.push(`## Metrics`);
  lines.push("");
  for (const [name, value] of Object.entries(summary.metrics)) {
    lines.push(`- \`${name}\`: ${value}`);
  }
  lines.push("");
  lines.push(`## Assertions`);
  lines.push("");
  for (const assertion of summary.assertions as EvidenceAssertion[]) {
    lines.push(`- ${assertion.ok ? "PASS" : "FAIL"} \`${assertion.name}\``);
  }
  lines.push("");
  if (summary.followupPaths.length > 0) {
    lines.push(`## Follow-ups`);
    lines.push("");
    for (const followupPath of summary.followupPaths as string[]) {
      lines.push(`- \`${followupPath}\``);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function buildFollowupsIndex(paths: string[]): string {
  const lines: string[] = [];
  lines.push(`# Queue/session/threading replay follow-ups`);
  lines.push("");
  if (paths.length === 0) {
    lines.push(`- None required.`);
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  for (const followupPath of paths) {
    lines.push(`- \`${followupPath}\``);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildFollowupMarkdown(input: {
  artifactDir: string;
  subsetAuditLogPath: string;
  evidenceJsonPath: string;
  replayCheckFailures: number;
  branchIsolationFailures: number;
  failedAssertions: EvidenceAssertion[];
}): string {
  const lines: string[] = [];
  lines.push(`---`);
  lines.push(`id: queue-session-threading-replay-followup`);
  lines.push(`title: Follow up queue/session/threading replay audit gaps`);
  lines.push(`status: next`);
  lines.push(`priority: medium`);
  lines.push(`created: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`tags:`);
  lines.push(`  - testing`);
  lines.push(`  - queue`);
  lines.push(`  - recovery`);
  lines.push(`---`);
  lines.push("");
  lines.push(`# Follow up queue/session/threading replay audit gaps`);
  lines.push("");
  lines.push(`- Artifact dir: \`${input.artifactDir}\``);
  lines.push(`- Subset audit log: \`${input.subsetAuditLogPath}\``);
  lines.push(`- DB/API evidence: \`${input.evidenceJsonPath}\``);
  lines.push(`- replay_check_failures: ${input.replayCheckFailures}`);
  lines.push(`- branch_isolation_failures: ${input.branchIsolationFailures}`);
  lines.push("");
  lines.push(`## Failed assertions`);
  lines.push("");
  if (input.failedAssertions.length === 0) {
    lines.push(`- None captured; investigate targeted suite failures from the subset audit log.`);
  } else {
    for (const assertion of input.failedAssertions) {
      lines.push(`- \`${assertion.name}\``);
    }
  }
  lines.push("");
  lines.push(`## Done when`);
  lines.push("");
  lines.push(`- [ ] bash scripts/audit-queue-session-threading-replay.sh is green.`);
  lines.push(`- [ ] The artifact summary shows zero replay and branch isolation failures.`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}
