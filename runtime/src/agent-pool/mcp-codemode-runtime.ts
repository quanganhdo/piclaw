import { createCodemodeExtension, type AgentSession, type AgentSessionRuntime, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from 'node:async_hooks';
import { commitMcpInstancePolicy, readMcpInstancePolicy } from "../core/config-mcp.js";
import { getMcpBridgeReadSnapshot, assertMcpBridgeSourcesCurrent, assertMcpCommittedSourcesCurrent, inspectMcpServerDefinitions, prepareMcpServerEdit, createMcpConfigWriteAuthority, writeMcpProjectOverride, hydrateMcpKeychainCredentials, McpConfigWriteError, type McpServerWriteCandidate, type McpConfigCommitReceipt } from "../secure/mcp-keychain.js";
import { acknowledgeMcpSessionsShutdown, reloadAcknowledgedMcpSessions } from './mcp-bridge-owner.js';
import { getWorkspaceDir } from '../core/config.js';
import { createLogger, debugSuppressedError } from '../utils/logger.js';
const log = createLogger('mcp-settings-runtime');
import { planMcpEnginePolicy } from "./mcp-engine-plan.js";
import { parseMcpEnginePolicy, type McpEnginePolicy } from "./mcp-engine-policy.js";

const READINESS = Object.freeze({ adapter: true, native: false, codemode: true });
let selected: Readonly<McpEnginePolicy> | null = null;
let blocked = false;
const ownerReloadContext = new AsyncLocalStorage<boolean>();
/** Only the private acknowledged replacement batch may construct while fenced. */
export function assertMcpOwnerConstruction(): void {
  if (ownerReloadContext.getStore() && selectedMcpPolicy().engine === 'adapter') return;
  assertSelectedMcpOwner();
}

export function selectedMcpPolicy(): Readonly<McpEnginePolicy> {
  return selected ??= readMcpInstancePolicy().policy;
}

export function assertSelectedMcpOwner(): void {
  if (blocked || selectedMcpPolicy().engine !== "adapter") {
    throw new Error("Selected MCP runtime is blocked or unavailable; explicit instance recovery is required.");
  }
}

function codemodeEnabled(): boolean {
  return !blocked && selectedMcpPolicy().engine === "adapter" && selectedMcpPolicy().codemode === "on";
}

type CodemodeSession = Pick<AgentSession, "getAllTools" | "getActiveToolNames" | "setActiveToolsByName">;

function syncMcpCodemodeSession(session: CodemodeSession, policy: Readonly<McpEnginePolicy>): void {
  if (!session.getAllTools().some(tool => tool.name === "codemode")) {
    throw new Error("Codemode extension did not load.");
  }
  const active = session.getActiveToolNames();
  if (active.includes("codemode") === (policy.codemode === "on")) return;
  const names = active.filter(name => name !== "codemode");
  if (policy.codemode === "on") names.push("codemode");
  session.setActiveToolsByName(names);
}

/** Fence already-captured sessions too, not only pool admission/new creation. */
export function bindMcpCodemodePolicy(session: CodemodeSession & Pick<AgentSession, "prompt">): void {
  syncMcpCodemodeSession(session, selectedMcpPolicy());
  const prompt = session.prompt.bind(session);
  session.prompt = (...args) => {
    assertSelectedMcpOwner();
    return prompt(...args);
  };
}

/** Public built-in tool, with model execution disabled until its budget seam is qualified. */
export const mcpCodemodeExtension: ExtensionFactory = async pi => {
  await createCodemodeExtension({ models: false })(pi);
  const sync = () => {
    const active = pi.getActiveTools();
    const enabled = codemodeEnabled();
    if (active.includes("codemode") === enabled) return;
    const names = active.filter(name => name !== "codemode");
    if (enabled) names.push("codemode");
    pi.setActiveTools(names);
  };
  pi.on("session_start", sync);
  pi.on("before_agent_start", sync);
  pi.on("tool_result", sync);
  pi.on("tool_call", event => {
    if (blocked) return { block: true, reason: "MCP instance settings are transitioning or blocked." };
    if (event.toolName === "codemode" && !codemodeEnabled()) {
      return { block: true, reason: "Codemode is disabled by the instance MCP policy." };
    }
  });
};

export const MCP_NATIVE_BLOCK_REASON = "Native Apply is blocked: transport shutdown acknowledgement and the Piclaw credential/exposure lifecycle are not qualified. Adapter remains the supported owner.";

/** Exact 1.0.1 public-contract probe gaps plus the separate close-failure probe. */
export const MCP_NATIVE_BLOCKERS = Object.freeze([
  "Transport shutdown failures can be suppressed; authoritative closure is not qualified.",
  "lazy: host-owned lazy connection lifecycle is not supported.",
  "statusObserver: host connection status observation is not supported.",
  "resourceFilter: host resource filtering is not supported.",
  "authStart: headless host-owned authentication initiation is not supported.",
  "appRenderer: host-owned MCP app rendering is not supported.",
  "absoluteDeadlineMs: Piclaw absolute operation deadlines are not supported.",
  "McpOAuthCredentialStore: the approved Piclaw credential contract is incompatible.",
  "socket: Unix socket transport configuration is not supported.",
  "listPrompts: public prompt listing is not supported.",
  "getPrompt: public prompt retrieval is not supported.",
]);

export class McpPolicyApplyError extends Error {
  constructor(readonly status: number, message: string, cause?: unknown) { super(message, { cause }); }
}

interface Revision {
  config: string;
  bridge: string;
  expires: number;
}
interface ServerRevision extends Revision { workspace: string; candidate?: McpServerWriteCandidate; preview?: unknown }

interface CodemodeHost {
  blockMcpAdmissions(): void;
  fenceMcpAndSnapshot(signal: AbortSignal): Promise<readonly AgentSessionRuntime[]>;
  resumeMcpAdmissions(): void;
  quarantineMcpRuntime(runtime: AgentSessionRuntime): Promise<void>;
}

/** Codemode-only changes do not replace or reload the existing MCP owner. */
export class McpCodemodeController {
  private phase: "ready" | "applying" | "blocked" = "ready";
  private readonly revisions = new Map<string, Revision>();
  private readonly serverRevisions = new Map<string, ServerRevision>();

  constructor(private readonly manager: CodemodeHost, private readonly timeoutMs = 30_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid MCP update deadline.");
  }

  inspect(policy?: unknown) {
    const persisted = readMcpInstancePolicy();
    const snapshot = getMcpBridgeReadSnapshot();
    const plan = planMcpEnginePolicy(policy ?? persisted.policy, snapshot, READINESS);
    if (plan.policy.engine === "native") {
      const issue = plan.issues.find(issue => issue.field === "engine");
      if (issue) issue.message = MCP_NATIVE_BLOCK_REASON;
    }
    const now = Date.now();
    for (const [key, value] of this.revisions) {
      if (value.expires <= now) this.revisions.delete(key);
    }
    while (this.revisions.size >= 128) this.revisions.delete(this.revisions.keys().next().value!);
    const revision = randomUUID();
    this.revisions.set(revision, { config: persisted.revision, bridge: snapshot.revision, expires: now + 300_000 });
    const { bridgeRevision: _private, ...publicPlan } = plan;
    const available = this.phase === "ready" && !blocked && selectedMcpPolicy().engine === "adapter";
    return {
      ok: true,
      persisted: { policy: persisted.policy },
      revision,
      runtime: {
        configuredFactory: "adapter",
        observedPolicy: blocked || selectedMcpPolicy().engine !== "adapter" ? null : { ...selectedMcpPolicy() },
        connectionStatus: "unknown",
        applyAvailable: available,
        phase: this.phase,
      },
      readiness: READINESS,
      servers: snapshot.dryRun.rows.map(row => ({ name: row.serverName, nativeProjectionStatus: row.status })),
      plan: publicPlan,
      applyAvailable: available && plan.applicable,
      effect: "abort_active_turns_and_update_codemode",
      nativeBlockReason: MCP_NATIVE_BLOCK_REASON,
      nativeBlockers: MCP_NATIVE_BLOCKERS,
    };
  }

  inspectServers(edit?: unknown) {
    const workspace = getWorkspaceDir(), current = readMcpInstancePolicy(), snapshot = getMcpBridgeReadSnapshot();
    const servers = inspectMcpServerDefinitions(workspace);
    const prepared = edit === undefined ? undefined : prepareMcpServerEdit(workspace, edit);
    const now = Date.now();
    for (const [token, value] of this.serverRevisions) if (value.expires <= now) this.serverRevisions.delete(token);
    while (this.serverRevisions.size >= 128) this.serverRevisions.delete(this.serverRevisions.keys().next().value!);
    const revision = randomUUID();
    this.serverRevisions.set(revision, { config: current.revision, bridge: snapshot.revision, workspace, expires: now + 300_000,
      ...(prepared ? { candidate: prepared.candidate, preview: prepared.preview } : {}) });
    return { ok: true, servers, revision, preview: prepared?.preview ?? null,
      applyAvailable: this.phase === 'ready' && !blocked && selectedMcpPolicy().engine === 'adapter' && current.policy.engine === 'adapter',
      phase: this.phase, effect: 'abort_turns_and_reload_extensions' };
  }

  async applyServers(input: { revision: string; acknowledgeInterruptions: boolean }, authorise: () => void, signal: AbortSignal) {
    authorise(); signal.throwIfAborted();
    if (!input.acknowledgeInterruptions) throw new McpPolicyApplyError(400, 'Confirm turn interruption and extension reload before applying server changes.');
    if (this.phase !== 'ready' || blocked) throw new McpPolicyApplyError(409, 'MCP settings are busy or blocked.');
    const token = this.serverRevisions.get(input.revision);
    if (!token?.candidate || token.expires <= Date.now() || token.workspace !== getWorkspaceDir()
      || token.config !== readMcpInstancePolicy().revision || token.bridge !== getMcpBridgeReadSnapshot().revision) throw new McpPolicyApplyError(409, 'Server preview expired or configuration changed; preview again.');
    assertMcpBridgeSourcesCurrent();
    if (selectedMcpPolicy().engine !== 'adapter' || readMcpInstancePolicy().policy.engine !== 'adapter') throw new McpPolicyApplyError(422, MCP_NATIVE_BLOCK_REASON);
    this.serverRevisions.delete(input.revision);
    this.phase = 'applying'; blocked = true;
    const deadlineAbort = new AbortController(), combined = AbortSignal.any([signal, deadlineAbort.signal]);
    let reject!: (reason: unknown) => void;
    const interrupted = new Promise<never>((_resolve, fail) => { reject = fail; });
    const onAbort = () => reject(combined.reason ?? Error('MCP transition cancelled.'));
    combined.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => deadlineAbort.abort(Error('MCP server update deadline exceeded.')), this.timeoutMs);
    const bounded = <T>(promise: Promise<T>) => Promise.race([promise, interrupted]);
    let commitReceipt: McpConfigCommitReceipt | undefined;
    const check = () => { combined.throwIfAborted(); authorise(); combined.throwIfAborted();
      if (commitReceipt) assertMcpCommittedSourcesCurrent(commitReceipt);
      if (getWorkspaceDir() !== token.workspace || readMcpInstancePolicy().revision !== token.config) throw Error('MCP instance binding changed.'); };
    let sessions: readonly AgentSessionRuntime[] = [], committed = false, failed = false;
    try {
      this.manager.blockMcpAdmissions();
      const pending = this.manager.fenceMcpAndSnapshot(combined);
      void pending.then(late => { if (combined.aborted) for (const runtime of late) void this.manager.quarantineMcpRuntime(runtime).catch(() => undefined); }, () => undefined);
      sessions = [...new Set(await bounded(pending))]; check();
      const receipt = await bounded(acknowledgeMcpSessionsShutdown(sessions.map(runtime => runtime.session), combined));
      check(); assertMcpBridgeSourcesCurrent();
      try {
        const write = writeMcpProjectOverride({ workspaceDir: token.workspace, expectedRevision: token.bridge, candidate: token.candidate,
          authority: createMcpConfigWriteAuthority({ workspaceDir: token.workspace, authorise: check, signal: combined }), onCommit: receipt => { commitReceipt = receipt; committed = true; } });
        // A post-rename unlock tail may outlive the response deadline. Observe
        // its commit receipt before reporting an ambiguous response outcome.
        await bounded(write);
        committed = true;
      } catch (error) { if (error instanceof McpConfigWriteError) committed = true; throw error; }
      check();
      await bounded(hydrateMcpKeychainCredentials(token.workspace, undefined, { authorise: check, signal: combined }));
      check();
      const editedName = (token.preview as { name?: string } | undefined)?.name;
      if (editedName && getMcpBridgeReadSnapshot().dryRun.rows.some(row => row.serverName === editedName && row.status === 'quarantined')
        && (token.preview as { enabled?: boolean }).enabled) throw Error('Edited server credentials or configuration could not be activated.');
      let release!: () => void, failStart!: (reason: unknown) => void, arrived!: () => void, count = 0;
      const start = new Promise<void>((resolve, reject) => { release = resolve; failStart = reject; });
      void start.catch(() => undefined);
      const ready = new Promise<void>(resolve => { arrived = resolve; if (!sessions.length) resolve(); });
      const replacing = ownerReloadContext.run(true, () => reloadAcknowledgedMcpSessions(receipt, { beforeSessionStart: async () => {
        check(); if (++count === sessions.length) arrived(); await start; check();
      } }));
      void replacing.finally(() => { if (failed) for (const runtime of sessions) void this.manager.quarantineMcpRuntime(runtime).catch(() => undefined); }).catch(() => undefined);
      void replacing.catch(error => failStart(error));
      try {
        await bounded(Promise.race([ready, replacing.then(() => { if (sessions.length) throw Error('MCP reload bypassed start barrier.'); })]));
        check(); release(); await bounded(replacing);
      } catch (error) { failStart(error); throw error; }
      for (const runtime of sessions) syncMcpCodemodeSession(runtime.session, selectedMcpPolicy());
      check(); this.manager.resumeMcpAdmissions(); check(); blocked = false; this.phase = 'ready'; this.revisions.clear(); this.serverRevisions.clear();
      return this.inspectServers();
    } catch (error) {
      debugSuppressedError(log, 'MCP server transition failed; admissions stay fenced.', error, { operation: 'mcp_settings.server_transition', committed });
      failed = true;
      deadlineAbort.abort(); blocked = true; this.phase = 'blocked'; this.manager.blockMcpAdmissions();
      for (const runtime of sessions) void this.manager.quarantineMcpRuntime(runtime).catch(() => undefined);
      throw new McpPolicyApplyError(committed ? 503 : 409, committed
        ? 'Server configuration saved, but activation was not confirmed. Operations remain blocked; repair the instance.'
        : 'Server update failed before configuration commit. Operations remain blocked; no fallback was selected.', error);
    } finally { clearTimeout(timer); combined.removeEventListener('abort', onAbort); }
  }

  async apply(input: { policy: unknown; revision: string; acknowledgeInterruptions: boolean }, authorise: () => void) {
    authorise();
    const policy = parseMcpEnginePolicy(input.policy);
    if (input.acknowledgeInterruptions !== true) {
      throw new McpPolicyApplyError(400, "Confirm that active turns may be interrupted before applying.");
    }
    if (this.phase !== "ready" || blocked) throw new McpPolicyApplyError(409, "MCP settings are busy or blocked.");
    const token = this.revisions.get(input.revision);
    if (!token || token.expires <= Date.now()) {
      throw new McpPolicyApplyError(409, "MCP settings changed or expired; refresh and preview again.");
    }
    const snapshot = getMcpBridgeReadSnapshot();
    const current = readMcpInstancePolicy();
    if (token.config !== current.revision || token.bridge !== snapshot.revision) {
      throw new McpPolicyApplyError(409, "MCP settings changed; refresh and preview again.");
    }
    const plan = planMcpEnginePolicy(policy, snapshot, READINESS);
    if (!plan.applicable) {
      throw new McpPolicyApplyError(422, policy.engine === "native" ? MCP_NATIVE_BLOCK_REASON : "MCP configuration is incompatible with this policy; preview the rejection reasons.");
    }
    if (selectedMcpPolicy().engine !== "adapter") {
      throw new McpPolicyApplyError(422, "Engine replacement is unavailable until authoritative shutdown is qualified.");
    }
    if (policy.codemode === selectedMcpPolicy().codemode && current.policy.codemode === policy.codemode) return this.inspect();
    this.phase = "applying";
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error("MCP policy update timed out."));
      }, this.timeoutMs);
    });
    const bounded = <T>(promise: Promise<T>) => Promise.race([promise, deadline]);
    let fenced = false, committed = false;
    let sessions: readonly AgentSessionRuntime[] = [];
    try {
      authorise();
      fenced = true;
      blocked = true;
      this.manager.blockMcpAdmissions();
      const pending = this.manager.fenceMcpAndSnapshot(abort.signal);
      // A timed-out snapshot may still deliver captured runtimes later.
      void pending.then(late => {
        if (abort.signal.aborted) {
          for (const runtime of late) void this.manager.quarantineMcpRuntime(runtime).catch(() => undefined);
        }
      }, () => undefined);
      sessions = [...new Set(await bounded(pending))];
      await bounded(Promise.all(sessions.map(runtime => runtime.session.abort())));
      authorise();
      if (abort.signal.aborted) throw new Error("MCP policy update cancelled.");
      if (getMcpBridgeReadSnapshot().revision !== token.bridge) throw new Error("MCP configuration changed during update.");
      if (sessions.some(runtime => !runtime.session.getAllTools().some(tool => tool.name === "codemode"))) {
        throw new Error("Codemode tool is missing from an existing session.");
      }
      commitMcpInstancePolicy(policy, token.config);
      committed = true;
      selected = policy;
      for (const runtime of sessions) syncMcpCodemodeSession(runtime.session, policy);
      this.manager.resumeMcpAdmissions();
      blocked = false;
      this.phase = "ready";
      this.revisions.clear();
      return this.inspect();
    } catch {
      abort.abort();
      if (fenced) {
        blocked = true;
        this.phase = "blocked";
        this.manager.blockMcpAdmissions();
        for (const runtime of sessions) void this.manager.quarantineMcpRuntime(runtime).catch(() => undefined);
      } else {
        this.phase = "ready";
      }
      const message = committed
        ? "Policy saved, but session activation failed. New operations remain blocked; restart or repair the instance."
        : fenced ? "MCP update failed; new operations remain blocked. No automatic fallback was selected."
        : "MCP update rejected before mutation; refresh and retry with current owner authority.";
      throw new McpPolicyApplyError(committed ? 503 : 409, message);
    } finally {
      clearTimeout(timer!);
    }
  }
}

export function resetMcpCodemodeRuntimeForTests(): void {
  selected = null;
  blocked = false;
}
