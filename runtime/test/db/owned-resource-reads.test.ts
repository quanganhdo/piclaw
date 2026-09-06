import { beforeEach, afterEach, expect, test } from "bun:test";
import "../helpers.js";
import { closeDatabase, initDatabase, getDb } from "../../src/db/connection.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { getUser } from "../../src/db/users.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../src/db/account-administration.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";
import { createOwnedRoot, archiveOwnedSession, restoreOwnedSession } from "../../src/db/owned-session-lifecycle.js";
import { authoriseOwnedMedia, readOwnedMediaInfo, exportOwnedArchivedTranscript } from "../../src/db/owned-resource-reads.js";
import { storeMessage } from "../../src/db/messages.js";
import { createMedia, attachMediaToMessage } from "../../src/db/media.js";
import { RequestRouterService } from "../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../src/channels/web/auth/auth-gateway.js";
import { WebauthnChallengeTracker } from "../../src/channels/web/auth/webauthn-challenges.js";
import { TotpFailureTracker } from "../../src/channels/web/auth/totp-failure-tracker.js";

let alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal, seq = 0;
function actor(id: string) {
  const login = createWebSession(`token-${id}`, id, 3600, "passkey");
  return resolveRequestPrincipal(new Request("https://family.local", { headers: { cookie: "piclaw_session=fixture" } }), { mode: "family-shared", authEnabled: true }, {
    getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => "Unused",
  })!;
}
function message(jid: string, content = "message") { return storeMessage({ id: `msg-${++seq}`, chat_jid: jid, content, sender: "user", sender_name: "Owner", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false }); }
function media(jid?: string, contentType = "image/png") {
  const id = createMedia("sample.png", contentType, new TextEncoder().encode("data"), new TextEncoder().encode("thumb"), { source_path: "/private/source", private_field: "hidden" });
  if (jid) attachMediaToMessage(message(jid), [id]);
  return id;
}
beforeEach(() => {
  closeDatabase(); initDatabase(); const admin = actor("default");
  for (const name of ["alice", "bob"]) {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: "family.local" });
    if (name === "alice") alice = actor(user.id); else bob = actor(user.id);
  }
});
afterEach(() => closeDatabase());

test("media access derives stored message ownership, including shared links and archive/revoke", () => {
  const mine = media(alice.homeChatJid!), foreign = media(bob.homeChatJid!), orphan = media();
  expect(() => authoriseOwnedMedia(getDb(), alice, mine)).not.toThrow();
  for (const id of [foreign, orphan, 999999, -1, NaN]) expect(() => authoriseOwnedMedia(getDb(), alice, id)).toThrow("Session access denied");
  attachMediaToMessage(message(alice.homeChatJid!), [foreign]);
  expect(() => authoriseOwnedMedia(getDb(), alice, foreign)).not.toThrow();
  const extra = createOwnedRoot(getDb(), alice, "archived"), archivedMedia = media(extra.chat_jid);
  archiveOwnedSession(getDb(), alice, extra.chat_jid);
  expect(() => authoriseOwnedMedia(getDb(), alice, archivedMedia)).toThrow();
  restoreOwnedSession(getDb(), alice, extra.chat_jid);
  expect(() => authoriseOwnedMedia(getDb(), alice, archivedMedia)).not.toThrow();
  const info = readOwnedMediaInfo(getDb(), alice, mine) as any;
  expect(info).toMatchObject({ id: mine, filename: "sample.png", content_type: "image/png" });
  expect(info.metadata).toBeUndefined(); expect(info.data).toBeUndefined();
  getDb().query("DELETE FROM web_sessions WHERE user_id=?").run(alice.userId);
  expect(() => authoriseOwnedMedia(getDb(), alice, mine)).toThrow();
});

test("forged root labels and unregistered chat links cannot establish media authority", () => {
  const root = createOwnedRoot(getDb(), bob, "foreign"); const id = media(root.chat_jid);
  getDb().query("UPDATE chat_branches SET root_chat_jid=? WHERE chat_jid=?").run(alice.homeChatJid!, root.chat_jid);
  expect(() => authoriseOwnedMedia(getDb(), alice, id)).toThrow();
  getDb().query("INSERT INTO chats(jid) VALUES ('unregistered')").run();
  const unregistered = media("unregistered"); expect(() => authoriseOwnedMedia(getDb(), alice, unregistered)).toThrow();
});

test("archive download is bounded text-only transcript with no service state or indirect IDs", () => {
  const root = createOwnedRoot(getDb(), alice, "export"), other = createOwnedRoot(getDb(), bob, "export");
  for (let i=0; i<4; i++) message(root.chat_jid, i === 0 ? "x".repeat(40_000) : `mine-${i}`);
  message(other.chat_jid, "foreign secret");
  getDb().query("UPDATE messages SET content_blocks=?,link_previews=?,annotations=? WHERE chat_jid=?").run('[{"private":"block secret"}]', '[{"private":"preview secret"}]', '[{"private":"annotation secret"}]', root.chat_jid);
  expect(() => exportOwnedArchivedTranscript(getDb(), alice, root.chat_jid)).toThrow();
  archiveOwnedSession(getDb(), alice, root.chat_jid); archiveOwnedSession(getDb(), bob, other.chat_jid);
  const first = exportOwnedArchivedTranscript(getDb(), alice, root.chat_jid, 2);
  expect(first.messages.map(row => row.content)).toEqual(["mine-2", "mine-3"]); expect(first.page.has_more).toBe(true);
  const second = exportOwnedArchivedTranscript(getDb(), alice, root.chat_jid, 2, first.page.next_before!);
  expect(second.page.has_more).toBe(false); expect(second.messages[0]!.content).toHaveLength(32000); expect(second.messages[0]!.content_truncated).toBe(1);
  const text = JSON.stringify(first); expect(text).not.toContain("foreign secret"); expect(text).not.toContain("block secret"); expect(text).not.toContain("preview secret"); expect(text).not.toContain("annotation secret");
  expect(first.omitted).toContain("service_configs"); expect(first.omitted).toContain("media");
  expect(() => exportOwnedArchivedTranscript(getDb(), alice, other.chat_jid)).toThrow();
  expect(() => exportOwnedArchivedTranscript(getDb(), alice, root.chat_jid, 501)).toThrow();
});

test("HTTP media and transcript reads are no-store and cannot be redirected by forged selectors", async () => {
  const json = (body: unknown, status=200) => Response.json(body, { status });
  const gateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "secret", hasTls: true, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway: gateway } as any, "family-shared");
  const req = (path: string, method = "GET") => router.handle(new Request("https://family.local" + path, { method, headers: { cookie: `piclaw_session=token-${alice.userId}` } }));
  const mine = media(alice.homeChatJid!), foreign = media(bob.homeChatJid!), html = media(alice.homeChatJid!, "text/html");
  const response = await req(`/media/${mine}`); expect(response.status).toBe(200); expect(await response.text()).toBe("data"); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await (await req(`/media/${mine}/thumbnail`)).text()).toBe("thumb");
  expect(await (await req(`/media/${mine}/info`)).text()).not.toContain("private_field");
  expect((await req(`/media/${html}`)).headers.get("content-disposition")).toContain("attachment");
  for (const path of [`/media/${foreign}?chat_jid=${alice.homeChatJid}`, "/media/999999", `/media/${mine}/extra`]) expect((await req(path)).status).toBe(403);
  expect((await req("/media/upload", "POST")).status).toBe(403);
  const root = createOwnedRoot(getDb(), alice, "download"); message(root.chat_jid, "owned transcript"); archiveOwnedSession(getDb(), alice, root.chat_jid);
  const downloaded = await req(`/agent/branch-download?chat_jid=${root.chat_jid}&limit=1`);
  expect(downloaded.status).toBe(200); expect(downloaded.headers.get("content-disposition")).toContain("attachment"); expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
  expect((await downloaded.json()).schema).toBe("piclaw.owned-transcript.v1");
  expect((await req("/agent/branch-download")).status).toBe(403);
  expect((await req(`/agent/branch-download?chat_jid=${bob.homeChatJid}`)).status).toBe(403);
});
