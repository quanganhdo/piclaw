import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';

/** Setup mutates auth/models/settings, so an explicit owned fixture is mandatory. */
export function requireFixturePaths(env: Record<string, string | undefined> = process.env) {
  const root = env.PICLAW_E2E_FIXTURE_ROOT;
  const workspace = env.PICLAW_WORKSPACE;
  const profile = env.PICLAW_PI_AGENT_DIR;
  if (env.PICLAW_E2E_DISPOSABLE !== '1' || !root || !workspace || !profile) throw new Error('E2E setup requires a declared disposable fixture root, workspace and Pi profile.');
  const realRoot = realpathSync(root);
  if (realRoot === realpathSync('/tmp') || !realRoot.startsWith(realpathSync('/tmp') + '/') || lstatSync(root).isSymbolicLink()) throw new Error('Fixture root must be an owned temporary directory.');
  if (readFileSync(join(realRoot, '.piclaw-e2e-fixture'), 'utf8').trim() !== 'piclaw disposable e2e') throw new Error('Missing E2E fixture ownership marker.');
  const inside = (path: string) => {
    const rel = relative(realRoot, resolve(path));
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Setup path must be inside the fixture root.');
    let p = realRoot;
    for (const part of rel.split('/')) {
      p = join(p, part);
      try { if (lstatSync(p).isSymbolicLink()) throw new Error('Symlink in E2E setup path.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
    }
    return resolve(path);
  };
  return { workspace: inside(workspace), profile: inside(profile) };
}
