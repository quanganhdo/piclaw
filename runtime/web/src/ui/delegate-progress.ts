/** Bounded public metadata only. Child output and reasoning are never UI inputs. */
export interface DelegateProgressRow {
  id: string;
  label: string;
  model: string;
  phase: string;
  detail: string;
}
interface PublicDelegateProgress { tool_call_id: string; model: string; phase: string; tools?: unknown; elapsedSeconds?: unknown; responseChars?: unknown; }
const phases: Record<string, string> = {
  starting: 'Starting', generating: 'Generating response', tool: 'Running tool', done: 'Complete', failed: 'Failed',
};
const identifier = /^[\w./:-]{1,256}$/;
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export function resolveDelegateProgressRows(value: unknown): DelegateProgressRow[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const records = value.slice(0, 32).filter((entry): entry is PublicDelegateProgress => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const { tool_call_id: id, model, phase } = entry;
    if (typeof id !== 'string' || !id || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id) || seen.has(id) ||
      typeof model !== 'string' || !identifier.test(model) || typeof phase !== 'string' || !Object.hasOwn(phases, phase)) return false;
    seen.add(id);
    return true;
  });
  return records.map((entry, index) => {
    const tools = Array.isArray(entry.tools) ? entry.tools.slice(0, 8)
      .filter((name: unknown): name is string => typeof name === 'string' && identifier.test(name)) : [];
    const seconds = count(entry.elapsedSeconds), chars = count(entry.responseChars);
    const detail = [entry.phase === 'tool' && tools.length ? `Running ${tools.join(', ')}` : phases[entry.phase]];
    if (seconds !== undefined) detail.push(seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`);
    if (chars !== undefined && chars > 0) detail.push(`${chars.toLocaleString('en-US')} response characters`);
    return { id: entry.tool_call_id, label: `Delegate ${index + 1}/${records.length}`, model: entry.model, phase: entry.phase, detail: detail.join(' · ') };
  });
}
