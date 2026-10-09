/** Durable host-authored role metadata. Absence means unknown, never intermediate. */
export type AgentMessageRole = "final" | "intermediate" | "unknown";
export const AGENT_MESSAGE_ROLE_BLOCK = "agent_message_role";

export function buildAgentMessageRoleBlock(role: AgentMessageRole, terminal: boolean): Record<string, unknown> {
  return { type: AGENT_MESSAGE_ROLE_BLOCK, version: 1, role, terminal };
}

export function getAgentMessageRole(isBot: boolean, terminal: boolean, blocks?: unknown[]): AgentMessageRole | null {
  if (!isBot) return null;
  // A positive legacy terminal bit is authoritative; zero is not.
  if (terminal) return "final";
  const roles = (blocks ?? []).filter((block): block is Record<string, unknown> => Boolean(
    block && typeof block === "object" && !Array.isArray(block)
    && (block as Record<string, unknown>).type === AGENT_MESSAGE_ROLE_BLOCK,
  ));
  // Ambiguous or malformed metadata is never eligible for intermediate cleanup.
  if (roles.length !== 1) return "unknown";
  if (roles[0].version !== 1 || roles[0].terminal !== terminal) return "unknown";
  if (roles[0].role === "final") return "final";
  return roles[0].role === "intermediate" && !roles[0].terminal ? "intermediate" : "unknown";
}
