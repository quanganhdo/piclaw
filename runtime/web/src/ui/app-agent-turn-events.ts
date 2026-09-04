export function shouldIgnoreMismatchedTurn(
  turnId: unknown,
  currentTurnId: unknown,
): boolean {
  return Boolean(turnId) && Boolean(currentTurnId) && turnId !== currentTurnId;
}

export function shouldAdoptIncomingTurn(
  turnId: unknown,
  currentTurnId: unknown,
): boolean {
  return Boolean(turnId) && !Boolean(currentTurnId);
}

export function resolveSteerQueuedTurnId(
  turnId: unknown,
  currentTurnId: unknown,
): unknown {
  return turnId || currentTurnId || null;
}

export function readPersistedIntermediateTurnId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const interaction = payload as Record<string, unknown>;
  const data = interaction.data && typeof interaction.data === 'object'
    ? interaction.data as Record<string, unknown>
    : interaction;
  const blocks = Array.isArray(data.content_blocks) ? data.content_blocks : [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (record.type !== 'agent_turn_marker') continue;
    const turnId = typeof record.turn_id === 'string' ? record.turn_id.trim() : '';
    const kind = record.kind;
    const cause = record.cause;
    const valid = kind === 'draft_snapshot'
      ? cause === 'interrupted_text_start' && record.followed_by_tool_use !== true
      : kind === 'intermediate' && (
          (cause === 'tool_use' && record.followed_by_tool_use === true)
          || ((cause === 'completed_boundary' || cause === 'failed_boundary') && record.followed_by_tool_use !== true)
        );
    if (valid && turnId) return turnId;
  }
  return null;
}
