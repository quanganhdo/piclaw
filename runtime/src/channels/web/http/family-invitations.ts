import { getDb } from "../../../db/connection.js";
import { AccountInvitations } from "../../../secure/account-invitations.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { checkCsrfOrigin, rateLimitResponse } from "./security.js";
import { isRateLimited } from "./rate-limit.js";
import { generateTotpQr } from "../../../utils/totp-qr.js";
import { resolveWebauthnRpInfo } from '../auth/webauthn-challenges.js';

/** Public but narrowly scoped enrolment ceremony. Successful confirmation is not a login. */
export async function handleFamilyInvitationRoutes(channel: WebChannelLike, req: Request): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (path === "/auth/invitation") {
    if ((req.method !== "GET" && req.method !== "HEAD") || (!channel.authGateway.createTotpContext().isTotpEnabled() && !channel.authGateway.createWebauthnContext().isPasskeyEnabled())) return channel.json({ error: "Invitation page unavailable." }, 403);
    const response = await channel.serveStatic("invitation.html", req);
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "private, no-store");
    if (req.method === "HEAD") {
      await response.body?.cancel();
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return response;
  }
  const passkey = ['/auth/invitation/passkey/claim', '/auth/invitation/passkey/check', '/auth/invitation/passkey/confirm'].includes(path);
  if (!passkey && path !== "/auth/invitation/claim" && path !== "/auth/invitation/confirm") return null;
  const deny = () => channel.json({ error: "Invalid or expired invitation." }, 403);
  if (req.method !== "POST" || new URL(req.url).search || !req.headers.get("origin") || !checkCsrfOrigin(req)) return deny();
  if (passkey ? !channel.authGateway.createWebauthnContext().isPasskeyEnabled() : !channel.authGateway.createTotpContext().isTotpEnabled()) return deny();
  if (isRateLimited(req, "auth/invitation", 5 * 60_000, 20)) return rateLimitResponse("Too many enrolment attempts. Try again later.");
  const origin = req.headers.get("origin")!;
  try {
    const body = await req.json();
    const claim = path.endsWith("/claim");
    const check = path.endsWith('/check');
    const allowed = claim ? ["token"] : passkey ? (check ? ['token', 'enrolment_token'] : ['token', 'enrolment_token', 'credential']) : ["token", "enrolment_token", "code"];
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))
      || typeof body.token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(body.token)) return deny();
    const invitations = new AccountInvitations(getDb());
    if (claim) {
      if (passkey) {
        const result = await invitations.claimPasskey(body.token, resolveWebauthnRpInfo(req).rpId, origin);
        const response = channel.json({ enrolment_token: result.enrolmentToken, options: result.options, expires_at: result.expiresAt, username: result.username, user_id: result.userId });
        response.headers.set('Referrer-Policy', 'no-referrer');
        response.headers.set('Set-Cookie', `piclaw_enrolment=${result.browserToken}; Path=/auth/invitation; HttpOnly; Secure; SameSite=Strict; Max-Age=300`);
        return response;
      }
      const result = await invitations.claim(body.token, origin);
      const { svg } = generateTotpQr({ secret: result.secret, issuer: "PiClaw", label: `PiClaw:${result.username}` });
      const response = channel.json({ enrolment_token: result.enrolmentToken, secret: result.secret, expires_at: result.expiresAt, username: result.username,
        qr_data_url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` });
      response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set("Set-Cookie", `piclaw_enrolment=${result.browserToken}; Path=/auth/invitation; HttpOnly; Secure; SameSite=Strict; Max-Age=300`);
      return response;
    }
    const cookies = (req.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith("piclaw_enrolment="));
    if (cookies.length !== 1 || typeof body.enrolment_token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(body.enrolment_token)) return deny();
    const browser = cookies[0]!.slice("piclaw_enrolment=".length);
    if (!/^[a-zA-Z0-9_-]{43}$/.test(browser)) return deny();
    if (passkey) {
      const rpId = resolveWebauthnRpInfo(req).rpId;
      if (check) { invitations.checkPasskey(body.token, browser, origin, body.enrolment_token, rpId); return channel.json({ valid: true }); }
      if (!body.credential || typeof body.credential !== 'object' || Array.isArray(body.credential)) return deny();
      await invitations.confirmPasskey(body.token, browser, origin, body.enrolment_token, rpId, body.credential);
    } else if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code) || !(await invitations.confirm(body.token, browser, origin, body.enrolment_token, body.code))) return deny();
    const response = channel.json({ enrolled: true, login_required: true });
    response.headers.set("Set-Cookie", "piclaw_enrolment=; Path=/auth/invitation; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
    return response;
  } catch { return deny(); }
}
