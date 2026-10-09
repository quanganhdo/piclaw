import { pathToFileURL } from 'node:url';
if (process.argv[2] === 'seed' || process.argv[2] === 'seed-missing-peer') {
  if (process.argv[2] === 'seed-missing-peer') {
    const { mock } = await import('bun:test');
    const native = await import('node:module');
    mock.module('node:module', () => ({ ...native, createRequire: () => ({ resolve: (name: string) => { throw new Error(`Missing host peer ${name}`); } }) }));
  }
  const { seedFreshWorkspaceCoreAddons } = await import('../../src/runtime/core-addon-defaults.js');
  console.log(JSON.stringify({ seeded: seedFreshWorkspaceCoreAddons(process.argv[3], process.argv[4], process.argv[5]) }));
} else {
  const module = await import(pathToFileURL(process.argv[2]).href);
  console.log(JSON.stringify(module.proof));
}
