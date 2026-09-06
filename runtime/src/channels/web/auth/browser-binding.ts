import type { AuthenticatedPrincipal } from "../../../core/access-types.js";

/** Optional account/session pin supplied by the family shell; it grants no authority itself. */
export function enforceBrowserBinding(req: Request, principal: AuthenticatedPrincipal): Response | null {
  const user = req.headers.get("x-piclaw-account-id");
  const login = req.headers.get("x-piclaw-login-id");
  if (user === null && login === null) return null;
  if (user === principal.userId && login === principal.authentication.sessionId) return null;
  return Response.json({ error: "Browser account changed. Reload before continuing.", code: "account_changed" }, {
    status: 409, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
