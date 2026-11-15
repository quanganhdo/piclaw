import { createHash, createHmac, randomBytes } from "node:crypto";
import { createLogger } from "../../src/utils/logger.js";

type Snapshot = { hashes: string[] };
export type PromptCacheAudit = Record<string, string | number | boolean>;
const MAX_SESSIONS = 16;
const MAX_ITEMS = 4096;
const MAX_BYTES = 8 * 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const jsonHash = (value: unknown) => hash(JSON.stringify(value) ?? "undefined");

/** Opt-in diagnosis only: retain hashes, never prompts, tool arguments or reasoning.
 * Bound both retained sessions and sampled input; diagnostics must not affect dispatch.
 */
export function createPromptCacheAuditor(emit: (record: PromptCacheAudit) => void) {
  const previous = new Map<string, Snapshot>();
  return (sessionId: string, payload: unknown): void => {
    try {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
      const body = payload as Record<string, unknown>;
      if (!Array.isArray(body.input)) return;
      const sessionHash = hash(sessionId);
      const hashes: string[] = [], bytes: number[] = [];
      let sampledBytes = 0;
      for (const item of body.input.slice(0, MAX_ITEMS)) {
        const json = JSON.stringify(item) ?? "null";
        const size = Buffer.byteLength(json);
        if (sampledBytes + size > MAX_BYTES) break;
        hashes.push(hash(json)); bytes.push(size); sampledBytes += size;
      }
      const prior = previous.get(sessionHash);
      let commonItems = 0, commonBytes = 0;
      while (prior && commonItems < Math.min(prior.hashes.length, hashes.length)
        && prior.hashes[commonItems] === hashes[commonItems]) {
        commonBytes += bytes[commonItems]!; commonItems++;
      }
      // Keep all non-input settings in one digest, including model/reasoning/include.
      const settings = Object.fromEntries(Object.entries(body).filter(([key]) =>
        !["input", "instructions", "tools", "prompt_cache_key"].includes(key)));
      const record: PromptCacheAudit = {
        sessionHash,
        cacheKeyPresent: typeof body.prompt_cache_key === "string" && body.prompt_cache_key.length > 0,
        cacheKeyHash: jsonHash(body.prompt_cache_key),
        instructionsHash: jsonHash(body.instructions), toolsHash: jsonHash(body.tools),
        instructionsBytes: typeof body.instructions === "string" ? Buffer.byteLength(body.instructions) : 0,
        instructionBlocks: typeof body.instructions === "string" ? JSON.stringify(body.instructions.split("\n\n").slice(0, 512).map(text => ({hash:hash(text),bytes:Buffer.byteLength(text)}))) : "[]",
        inputPrefixHashes: JSON.stringify(hashes.slice(0, 16)),
        settingsHash: jsonHash(settings), inputHash: jsonHash(hashes),
        inputItems: body.input.length, sampledItems: hashes.length, sampledBytes,
        sampleComplete: hashes.length === body.input.length,
        hadPrevious: prior !== undefined, commonItems, commonBytes,
        previousSampleItems: prior?.hashes.length ?? 0,
      };
      previous.delete(sessionHash);
      previous.set(sessionHash, { hashes });
      if (previous.size > MAX_SESSIONS) previous.delete(previous.keys().next().value!);
      emit(record);
    } catch { /* An optional audit must never reject a provider request. */ }
  };
}

const log = createLogger("durable.prompt-cache");
const audit = createPromptCacheAuditor(record => log.info("Codex prompt cache fingerprint", record));
export function auditCodexPromptCache(sessionId: string, payload: unknown): void {
  if (process.env.PICLAW_PROMPT_CACHE_AUDIT === "1") audit(sessionId, payload);
}


/** Final HTTP routing only. Never retain URLs, credentials or header values. */
export function createPromptTransportAuditor(emit: (record: PromptCacheAudit) => void) {
  const key = randomBytes(32);
  const credentials = new Map<string, { digest: string; epoch: number }>();
  return (sessionId: string, input: string | URL | Request, init?: RequestInit, response?: Response): void => {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const headers = new Headers(response ? response.headers : init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const record: PromptCacheAudit = {
        auditType: response ? "response" : "dispatch", sessionHash: hash(sessionId),
        routeHash: hash(url.origin + url.pathname),
        ...(response ? { status: response.status, responseUrlHash: response.url ? hash(new URL(response.url).origin + new URL(response.url).pathname) : "" } : {}),
      };
      if (!response) {
        const digest = createHmac("sha256", key).update(headers.get("authorization") ?? "").digest("hex");
        const previous = credentials.get(sessionId);
        const epoch = previous ? previous.epoch + Number(previous.digest !== digest) : 1;
        credentials.delete(sessionId); credentials.set(sessionId, { digest, epoch });
        if (credentials.size > MAX_SESSIONS) credentials.delete(credentials.keys().next().value!);
        record.credentialEpoch = epoch;
      }
      const names = [...headers.keys()].sort().slice(0, 64);
      record.headerNamesHash = jsonHash(names);
      for (const name of names) {
        if (/(authorization|cookie|api.?key|token|secret)/i.test(name)) continue;
        record["header_" + name.slice(0, 80)] = jsonHash(headers.get(name));
      }
      if (!response && typeof init?.body === "string") {
        record.wireBytes = Buffer.byteLength(init.body); record.wireHash = hash(init.body);
      } else if (!response && ArrayBuffer.isView(init?.body)) {
        const bytes = init.body as ArrayBufferView;
        record.wireBytes = bytes.byteLength;
        record.wireHash = createHash("sha256").update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex");
      }
      if (!response && init?.body) {
        try {
          let bytes = typeof init.body === "string" ? Buffer.from(init.body) : ArrayBuffer.isView(init.body)
            ? new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength) : undefined;
          if (bytes && bytes.byteLength <= MAX_BYTES) {
            const decoded = headers.get("content-encoding") === "zstd" ? Bun.zstdDecompressSync(bytes) : bytes;
            if (decoded && decoded.byteLength <= MAX_BYTES) {
              const decodedBytes = decoded.byteLength;
              const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
              record.wireInstructionsHash = jsonHash(body.instructions);
              record.wireCacheKeyHash = jsonHash(body.prompt_cache_key);
              record.wireInputPrefixHashes = JSON.stringify(Array.isArray(body.input) ? body.input.slice(0, 16).map(jsonHash) : []);
              record.wireDecodedBytes = decodedBytes;
            }
          }
        } catch { record.wireInspectionComplete = false; }
      }
      emit(record);
    } catch { /* Optional diagnostics cannot alter dispatch or response handling. */ }
  };
}
const auditTransport = createPromptTransportAuditor(record => log.info("Codex transport fingerprint", record));
export function auditCodexTransport(sessionId: string, input: string | URL | Request, init?: RequestInit, response?: Response): void {
  if (process.env.PICLAW_PROMPT_CACHE_AUDIT === "1") auditTransport(sessionId, input, init, response);
}
