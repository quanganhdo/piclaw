/**
 * agent-control/handlers/totp.ts – Build TOTP enrolment/setup confirmation flows.
 *
 * Commands:
 *   /totp                  – show single-card TOTP setup/secondary-device flow
 *   /totp enrol / enroll   – alias for the same flow
 *   /totp reset <code>     – verify current code, then show single-card reset confirmation flow
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { readAccessConfig } from "../../core/config-access.js";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { getIdentityConfig, getWebRuntimeConfig } from "../../core/config.js";
import { getChatChannel } from "../../core/chat-context.js";
import { verifyTotp } from "../../channels/web/auth/auth.js";
import {
  buildTotpAdaptiveCard,
  createTotpCardToken,
  hashTotpSecret,
  type TotpCardFlow,
} from "../../channels/web/auth/totp-card.js";
import { generateTotpQr } from "../../utils/totp-qr.js";

type TotpCommand = Extract<AgentControlCommand, { type: "totp" }>;

function createCandidateSecret(issuer: string, label: string): string {
  return generateTotpQr({ issuer, label }).secret;
}

function describeFlow(flow: TotpCardFlow): string {
  switch (flow) {
    case "setup":
      return "TOTP setup";
    case "secondary":
      return "TOTP device validation";
    case "reset":
      return "TOTP reset";
    default:
      return "TOTP";
  }
}

/** Handle `/totp` control commands for single-card setup/reset flows. */
export async function handleTotp(_session: AgentSession, command: TotpCommand): Promise<AgentControlResult> {
  if (readAccessConfig().mode !== "single-user") return { status: "error", message: "Use account-bound enrolment or recovery in this access mode." };
  const action = (command.action || "").toLowerCase();
  if (action && action !== "enrol" && action !== "enroll" && action !== "reset") {
    return { status: "error", message: "Usage: /totp enrol|enroll|reset" };
  }

  const channel = getChatChannel();
  if (channel !== "web") {
    return { status: "error", message: "TOTP setup cards are only available in the web UI." };
  }

  const webRuntimeConfig = getWebRuntimeConfig();
  const currentSecret = (webRuntimeConfig.totpSecret || "").trim();
  const hasSecret = Boolean(currentSecret);
  const isReset = action === "reset";

  if (isReset && !hasSecret) {
    return { status: "error", message: "TOTP is not configured (PICLAW_WEB_TOTP_SECRET is empty)." };
  }

  if (isReset) {
    const code = (command.code || "").trim();
    if (!code) {
      return {
        status: "error",
        message: "Usage: /totp reset <6-digit code> (current TOTP code required for confirmation).",
      };
    }

    if (!verifyTotp(currentSecret, code, webRuntimeConfig.totpWindow)) {
      return { status: "error", message: "Invalid confirmation code." };
    }
  }

  const identity = getIdentityConfig();
  const issuer = identity.assistantName || "Piclaw";
  const label = identity.userName ? `${issuer}:${identity.userName}` : issuer;
  const flow: TotpCardFlow = isReset ? "reset" : hasSecret ? "secondary" : "setup";
  const candidateSecret = flow === "secondary" ? currentSecret : createCandidateSecret(issuer, label);
  const token = createTotpCardToken({
    flow,
    secret: candidateSecret,
    previousSecretHash: hashTotpSecret(currentSecret),
  });
  const card = buildTotpAdaptiveCard({
    flow,
    secret: candidateSecret,
    issuer,
    label,
    token,
  });

  const message = flow === "setup"
    ? "Use the card below to set up TOTP, then confirm it with a live 6-digit code from your authenticator. Nothing is saved until confirmation succeeds."
    : flow === "secondary"
      ? "Use the card below to add another TOTP device, then confirm it with a live 6-digit code. The active secret will not change."
      : "Current TOTP code accepted. Use the card below to confirm the new secret with a live 6-digit code. Nothing changes until confirmation succeeds.";

  return {
    status: "success",
    message: `${describeFlow(flow)} — ${message}`,
    contentBlocks: [card],
  };
}
