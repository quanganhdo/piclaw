import { readAccessConfig } from "./config-access.js";
import { getExecutionIdentity } from "./execution-context.js";

/** Legacy Dream combines all chats and shared memory. A denial is permanent for this invocation. */
export function createDreamAccessGuard(): () => void {
  let denied = false;
  const check = () => {
    if (!denied) {
      try {
        const identity = getExecutionIdentity();
        denied = readAccessConfig().mode !== "single-user" || (!!identity && identity.mode !== "single-user");
      } catch {
        denied = true;
      }
    }
    if (denied) throw new Error("Dream requires valid single-user configuration and context.");
  };
  check();
  return check;
}
