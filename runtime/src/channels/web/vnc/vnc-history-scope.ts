import { createHash } from "node:crypto";
import { WORKSPACE_DIR } from "../../../core/config.js";
import { getWebSession } from "../../../db.js";
import { getSessionTokenFromRequest } from "../auth/session-auth.js";

/** Opaque account/instance history namespace, never a session credential. */
export function getVncHistoryScope(
  req: Request,
  allowUnauthenticated = false,
): string | null {
  const token = getSessionTokenFromRequest(req);
  const session = token ? getWebSession(token) : null;
  if (!session && !allowUnauthenticated) return null;
  return createHash("sha256")
    .update(
      JSON.stringify([
        WORKSPACE_DIR,
        new URL(req.url).origin,
        session?.user_id || "local",
      ]),
    )
    .digest("hex");
}
