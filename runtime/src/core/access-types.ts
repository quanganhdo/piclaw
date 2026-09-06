import type { AccessMode } from "./config-access.js";

export type AccessAction =
  | "account.read-self" | "account.update-self" | "account.manage-users"
  | "session.read" | "session.write" | "session.fork" | "session.rename" | "session.archive"
  | "instance.configure";

/** Authentication actor, separate from the owner of a requested resource. No bearer material. */
export interface AuthenticatedPrincipal {
  readonly kind: "user" | "local";
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: "admin" | "member";
  readonly mode: AccessMode;
  readonly homeChatJid: string | null;
  readonly authentication: Readonly<{ method: string; sessionId: string | null; expiresAt: string | null }>;
}
