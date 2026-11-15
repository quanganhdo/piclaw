/** Atomic persistence for explicit legacy file-history consumers. No model execution. */
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/** Persist the current session entries immediately, even before another assistant response arrives. */
export function forcePersistSessionFile(session: AgentSession): string | null {
  const sessionFile = session.sessionFile;
  const header = session.sessionManager.getHeader();
  if (!sessionFile || !header) return null;

  mkdirSync(dirname(sessionFile), { recursive: true });
  const entries = session.sessionManager.getEntries();
  const content = [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n");
  const tempPath = `${sessionFile}.persisting-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, `${content}\n`, { flag: "wx" });
    renameSync(tempPath, sessionFile);
    return sessionFile;
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}
