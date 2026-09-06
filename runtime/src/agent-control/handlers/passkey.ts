/**
 * agent-control/handlers/passkey.ts – Manage WebAuthn passkeys.
 *
 * Commands:
 *   /passkey enrol|enroll  – generate a one-time enrolment link
 *   /passkey list          – list registered passkeys
 *   /passkey delete <id>   – delete a passkey by ID prefix
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { readAccessConfig } from "../../core/config-access.js";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { getWebRuntimeConfig } from "../../core/config.js";
import { getChatChannel, getChatJid } from "../../core/chat-context.js";
import { getWebOrigin } from "../../channels/web/auth/request-origin.js";
import {
  createWebauthnEnrollment,
  listWebauthnCredentials,
  findWebauthnCredentialsByPrefix,
  deleteWebauthnCredential,
  DEFAULT_WEB_USER_ID,
} from "../../db.js";

const MAX_LINK_MINUTES = 5;

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
        "• /passkey enrol – generate a one-time enrolment link\n" +
        "• /passkey list – list registered passkeys\n" +
        "• /passkey delete <id> – remove a passkey by ID prefix",
    };
  }

  if (action === "enrol" || action === "enroll") {
    const webRuntimeConfig = getWebRuntimeConfig();
    if (!webRuntimeConfig.totpSecret || !webRuntimeConfig.totpSecret.trim()) {
      return { status: "error", message: "TOTP is not configured; enrolment is disabled." };
    }
    const channel = getChatChannel();
    if (channel !== "web") {
      return { status: "error", message: "Passkey enrolment must be started from the web UI." };
    }
    const enrollment = createWebauthnEnrollment(DEFAULT_WEB_USER_ID, MAX_LINK_MINUTES * 60);
    const relative = `/auth/webauthn/enrol?token=${enrollment.token}`;
    const origin = getWebOrigin(getChatJid()) || "";
    const absolute = origin ? `${origin}${relative}` : relative;
    const message = [
      "Open this link in the same browser to register a passkey:",
      absolute.startsWith("http") ? absolute : `<${absolute}>`,
      `This link expires in ${MAX_LINK_MINUTES} minutes.`,
    ].join("\n");
    return { status: "success", message };
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
    deleteWebauthnCredential(matches[0].credential_id);
    return { status: "success", message: "Passkey removed." };
  }

  return { status: "error", message: "Unknown passkey action. Use /passkey for help." };
}
