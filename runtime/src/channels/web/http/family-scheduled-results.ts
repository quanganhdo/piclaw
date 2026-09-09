import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import { getDb } from "../../../db/connection.js";
import { requireAccountActor } from "../../../db/account-administration.js";
import { listOwnFamilyScheduledResults, readOwnFamilyScheduledResult, cancelOwnFamilyScheduledExecution } from "../../../db/family-scheduled-executions.js";
import { publishOwnFamilyScheduledResult } from "../../../db/family-scheduled-publications.js";
import { ChatAccessDenied } from "../../../db/session-ownership.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { checkCsrfOrigin, rateLimitResponse } from "./security.js";
import { isRateLimitedForClient } from "./rate-limit.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("web.family-scheduled-results");
async function confirmation(req: Request): Promise<void> {
  if (!req.body) throw new ChatAccessDenied();
  const reader = req.body.getReader(), bytes = new Uint8Array(1024);
  let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const cancelled = new Promise<never>((_,reject) => {
    abort = () => reject(new ChatAccessDenied()); timer = setTimeout(abort,10000);
    req.signal.addEventListener("abort",abort,{once:true});
  });
  try {
    if (req.signal.aborted) throw new ChatAccessDenied();
    for (;;) {
      const {done,value} = await Promise.race([reader.read(),cancelled]);
      if (done) break;
      if (size + value.byteLength > bytes.byteLength) throw new ChatAccessDenied();
      bytes.set(value,size);size+=value.byteLength;
    }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,size))); }
    catch { throw new ChatAccessDenied(); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || (body as {confirm?:unknown}).confirm !== true) throw new ChatAccessDenied();
  } finally {
    clearTimeout(timer);req.signal.removeEventListener("abort",abort);
    void reader.cancel().catch(() => log.debug("Confirmation stream already closed",{operation:"scheduled_result.cancel"}));reader.releaseLock();
  }
}

/** Owner inspection, cancellation and publication; never task execution or token submission. */
export async function handleFamilyScheduledResults(channel: WebChannelLike, req: Request, actor: AuthenticatedPrincipal): Promise<Response> {
  const deny = () => channel.json({error:"Session access denied."},403);
  const url = new URL(req.url), match = url.pathname.match(/^\/agent\/scheduled-results\/([a-zA-Z0-9_-]{1,128})(\/publish|\/cancel)?$/);
  if (url.search || req.headers.get("x-piclaw-account-id") !== actor.userId || req.headers.get("x-piclaw-login-id") !== actor.authentication.sessionId) return deny();
  try {
    if (url.pathname === "/agent/scheduled-results" && req.method === "GET") return channel.json(listOwnFamilyScheduledResults(getDb(),actor));
    if (!match) return deny();
    if (req.method === "GET" && !match[2]) return channel.json(readOwnFamilyScheduledResult(getDb(),actor,match[1]!));
    if (req.method !== "POST" || !match[2] || !req.headers.get("origin") || !checkCsrfOrigin(req)) return deny();
    const cancelling=match[2]==='/cancel';
    if(cancelling&&req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return deny();
    requireAccountActor(getDb(),actor,{recent:true});
    if (isRateLimitedForClient(actor.userId,cancelling?"family_execution_cancel":"family_result_publish",60000,20)) return rateLimitResponse(cancelling?"Too many cancellation requests.":"Too many publication requests.");
    await confirmation(req); if (req.signal.aborted) throw new ChatAccessDenied();
    // All account, target and result checks run again in the write transaction after body consumption.
    if(cancelling){const cancelled=cancelOwnFamilyScheduledExecution(getDb(),actor,match[1]!);return channel.json(cancelled,cancelled.created?201:200);}
    const published = publishOwnFamilyScheduledResult(getDb(),actor,match[1]!);
    return channel.json(published,published.created ? 201 : 200);
  } catch (error) {
    if (error instanceof ChatAccessDenied || req.signal.aborted) return deny();
    log.error("Scheduled result request failed", {operation:"scheduled_result.request_failed",err:error});
    return channel.json({error:"Scheduled result request failed."},500);
  }
}
