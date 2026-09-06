import type { AccessMode } from "../../../core/config-access.js";

interface LoginPolicyGateway {
  isAuthEnabled(): boolean;
  createTotpContext(): { isTotpEnabled(): boolean };
  createWebauthnContext(): { isPasskeyEnabled(): boolean };
}

/** Public method discovery only. Never resolves an account, cookie or credential inventory. */
export function loginOptionsResponse(req: Request, mode: AccessMode, gateway: LoginPolicyGateway): Response {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") return Response.json({ error: "Method not allowed" }, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
  if (mode === "isolated-containers") return new Response(req.method === "HEAD" ? null : JSON.stringify({ error: "Isolated login is unavailable." }), { status: 503, headers });
  const enabled = gateway.isAuthEnabled();
  const totp = enabled && gateway.createTotpContext().isTotpEnabled();
  const passkey = enabled && gateway.createWebauthnContext().isPasskeyEnabled();
  return new Response(req.method === "HEAD" ? null : JSON.stringify({
    mode, auth_enabled: enabled, totp, passkey, username_required: mode === "family-shared" && totp,
  }), { headers });
}
