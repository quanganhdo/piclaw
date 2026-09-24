/**
 * agent-control/handlers/passkey.ts – Manage WebAuthn passkeys.
 *
 * Commands:
 *   /passkey enrol|enroll  – open passkey Settings
 *   /passkey list          – list registered passkeys
 *   /passkey delete <id>   – direct removal to authenticated Settings
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { readAccessConfig } from "../../core/config-access.js";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { getWebRuntimeConfig } from "../../core/config.js";
import {
  listWebauthnCredentials,
  findWebauthnCredentialsByPrefix,
  DEFAULT_WEB_USER_ID,
} from "../../db.js";

type PasskeyCommand = Extract<AgentControlCommand, { type: "passkey" }>;

const isPasskeysEnabled = () => (getWebRuntimeConfig().passkeyMode || "").toLowerCase() !== "totp-only";

const maskCredential = (id: string): string => {
  if (!id) return "unknown";
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
};

/** Handle `/passkey` subcommands (list/delete/enrol) for agent-control flows. */
export async function handlePasskey(_session: AgentSession, command: PasskeyCommand): Promise<AgentControlResult> {
  if (readAccessConfig().mode !== "single-user") return { status: "error", message: "Use the account-bound passkey API in this access mode." };
  if (!isPasskeysEnabled()) {
    return { status: "error", message: "Passkeys are disabled (WEB_PASSKEY_MODE=totp-only)." };
  }

  const action = (command.action || "").toLowerCase();
  if (!action) {
    return {
      status: "success",
      message:
        "Passkey commands:\n" +
        "• /passkey enrol – use Settings → Authentication\n" +
        "• /passkey list – list registered passkeys\n" +
        "• /passkey delete <id> – use Settings → Authentication to remove a passkey",
    };
  }

  if (action === "enrol" || action === "enroll") {
    return { status: "success", message: "Add passkeys in Settings → Authentication. Sign in again there if requested; no enrolment link was created." };
  }

  if (action === "list") {
    const creds = listWebauthnCredentials(DEFAULT_WEB_USER_ID);
    if (creds.length === 0) {
      return { status: "success", message: "No passkeys registered." };
    }
    const lines = ["Registered passkeys:"];
    for (const cred of creds) {
      const created = cred.created_at ? cred.created_at.replace("T", " ").replace("Z", "") : "unknown";
      lines.push(`• ${maskCredential(cred.credential_id)} (${cred.rp_id}, ${created})`);
    }
    return { status: "success", message: lines.join("\n") };
  }

  if (action === "delete" || action === "remove") {
    if (!command.target) {
      return { status: "error", message: "Usage: /passkey delete <credential-id-prefix>" };
    }
    const matches = findWebauthnCredentialsByPrefix(DEFAULT_WEB_USER_ID, command.target.trim());
    if (matches.length === 0) {
      return { status: "error", message: "No passkey matches that ID prefix." };
    }
    if (matches.length > 1) {
      const suggestions = matches.map((cred) => maskCredential(cred.credential_id));
      return { status: "error", message: `Ambiguous prefix. Matches: ${suggestions.join(", ")}` };
    }
    // Agent-control has no browser-bound recent proof. Never bypass the
    // Settings transaction's current-RP and last-usable-factor checks here.
    return { status: "error", message: "Remove passkeys in Settings → Authentication after signing in again. No passkey was removed." };
  }

  return { status: "error", message: "Unknown passkey action. Use /passkey for help." };
}
