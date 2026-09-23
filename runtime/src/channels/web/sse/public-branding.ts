/** Only public instance branding may be delivered globally to family clients. */
export function projectPublicBranding(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const p = data as Record<string, unknown>;
  if (p.agent_id !== 'default') return null;
  const avatar = typeof p.agent_avatar === 'string' && /^\/avatar\/agent(?:\?v=[a-zA-Z0-9%._:-]+)?$/.test(p.agent_avatar) ? p.agent_avatar : null;
  return { agent_id: 'default', agent_name: typeof p.agent_name === 'string' ? p.agent_name : 'PiClaw', agent_avatar: avatar };
}
