import type { RunAgentOptions } from "./contracts.js";
import { rememberActiveToolSubset } from "./active-tool-subset-memory.js";
import { logToolStateTransition } from "./tool-state-transitions.js";
import { getExecutionIdentity } from '../core/execution-context.js';
import { isFamilyWebToolAllowed } from '../core/family-workspace-policy.js';

export interface SessionWithToolControl {
  setActiveToolsByName?: (toolNames: string[]) => void;
  getActiveToolNames?: () => string[];
}

export interface RunToolCeilingController {
  apply(owner: SessionWithToolControl | null): boolean;
  release(): void;
  getOwner(): SessionWithToolControl | null;
}

export function createRunToolCeilingController(options: {
  chatJid: string;
  runOptions: RunAgentOptions;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
}): RunToolCeilingController {
  let owner: SessionWithToolControl | null = null;
  let savedToolNames: string[] | null = null;
  let originalSetActiveToolsByName: ((names: string[]) => void) | null = null;

  const release = () => {
    if (!owner || savedToolNames === null || !originalSetActiveToolsByName) return;
    const previousOwner = owner;
    const previousTools = savedToolNames;
    const previousSetter = originalSetActiveToolsByName;
    previousOwner.setActiveToolsByName = previousSetter;
    owner = null;
    savedToolNames = null;
    originalSetActiveToolsByName = null;
    try {
      previousSetter.call(previousOwner, previousTools);
      logToolStateTransition({
        chatJid: options.chatJid,
        turnId: options.runOptions.turnId,
        phase: "attempt",
        cause: "tool_ceiling_restore",
        previous: [],
        next: previousTools,
        restored: true,
      });
    } catch (error) {
      options.onWarn?.("Failed to restore tool ceiling owner; continuing with ownership released", {
        operation: "run_agent.tool_ceiling_restore_failed",
        chatJid: options.chatJid,
        err: error,
      });
    }
  };

  return {
    apply(nextOwner) {
      release();
      const identity = getExecutionIdentity();
      const family = identity?.mode === 'family-shared';
      if (family && (!identity.toolPolicy || !Array.isArray(identity.toolPolicy.allowed))) throw new Error('Family tool policy snapshot is required.');
      const requested = options.runOptions.toolCeilingFilter;
      // A caller may narrow the family ceiling but cannot omit or widen it.
      const ceilingFilter = family ? (name: string) => isFamilyWebToolAllowed(name) && identity.toolPolicy!.allowed.includes(name) && (!requested || requested(name)) : requested;
      if (identity && identity.mode !== 'single-user' && !family) throw new Error('Isolated tool execution is unavailable.');
      if (family && !nextOwner) throw new Error('Family execution requires active-tool controls.');
      if (!ceilingFilter || !nextOwner) return false;
      if (typeof nextOwner.getActiveToolNames !== "function" || typeof nextOwner.setActiveToolsByName !== "function") {
        if (family) throw new Error('Family execution requires active-tool controls.');
        options.onWarn?.("Tool ceiling requested but session lacks active-tool controls; ceiling not enforced", {
          operation: "run_agent.tool_ceiling",
          chatJid: options.chatJid,
        });
        return false;
      }
      owner = nextOwner;
      savedToolNames = nextOwner.getActiveToolNames();
      rememberActiveToolSubset(nextOwner, savedToolNames);
      originalSetActiveToolsByName = nextOwner.setActiveToolsByName;
      const ceilingTools = savedToolNames.filter(ceilingFilter);
      originalSetActiveToolsByName.call(nextOwner, ceilingTools);
      logToolStateTransition({
        chatJid: options.chatJid,
        turnId: options.runOptions.turnId,
        phase: "attempt",
        cause: "tool_ceiling_apply",
        previous: savedToolNames,
        next: ceilingTools,
      });
      nextOwner.setActiveToolsByName = (names: string[]) => {
        originalSetActiveToolsByName?.call(nextOwner, names.filter(ceilingFilter));
      };
      return true;
    },
    release,
    getOwner: () => owner,
  };
}
