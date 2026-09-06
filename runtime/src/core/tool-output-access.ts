import { readAccessConfig } from "./config-access.js";
import { getExecutionIdentity } from "./execution-context.js";

export class ToolOutputAccessDenied extends Error {
  constructor() { super("Legacy tool output requires valid single-user configuration and context."); }
}

/** Legacy output records and cached summaries have no owner-aware retrieval contract. */
export function canUseLegacyToolOutput(): boolean {
  try {
    const identity = getExecutionIdentity();
    return readAccessConfig().mode === "single-user" && (!identity || identity.mode === "single-user");
  } catch {
    return false;
  }
}

export function createToolOutputAccessGuard(): () => void {
  let allowed = true;
  const check = () => {
    allowed = allowed && canUseLegacyToolOutput();
    if (!allowed) throw new ToolOutputAccessDenied();
  };
  check();
  return check;
}
