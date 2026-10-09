import type { AgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { sharedModelRequestBoundary, type SharedModelRequestHost } from './shared-model-request-boundary.js';
const runtimeOwners = new WeakSet<object>();
const agentOwners = new WeakSet<object>();

/** Explicit host-only installation, with no configured default or fallback.
 * Use only after the host's actual provider/auth/tariff/limit contracts qualify.
 * Main/side sessions and non-session simple callers share the same factory. */
export function installSharedRequestBoundary(runtime: Pick<ModelRuntime, 'streamSimple'>, host: SharedModelRequestHost) {
  if (runtimeOwners.has(runtime)) throw Error('Shared request boundary is already installed.');
  const original = runtime.streamSimple;
  const guarded: ModelRuntime['streamSimple'] = sharedModelRequestBoundary(host);
  runtime.streamSimple = guarded;
  runtimeOwners.add(runtime);
  let released = false;
  const sessions = new Map<AgentSession['agent'], AgentSession['agent']['streamFunction']>();
  return {
    attach(session: Pick<AgentSession, 'agent'>) {
      if (released) throw Error('Shared request boundary is released.');
      const agent = session.agent;
      if (!sessions.has(agent)) {
        if (agentOwners.has(agent)) throw Error('Agent already has a shared request boundary.');
        const previous = agent.streamFunction;
        agent.streamFunction = guarded;
        sessions.set(agent, previous);
        agentOwners.add(agent);
      }
    },
    release() {
      if (released) return; released = true;
      if (runtime.streamSimple === guarded) runtime.streamSimple = original;
      runtimeOwners.delete(runtime);
      for (const [agent, previous] of sessions) {
        if (agent.streamFunction === guarded) agent.streamFunction = previous;
        agentOwners.delete(agent);
      }
      sessions.clear();
    },
  };
}
