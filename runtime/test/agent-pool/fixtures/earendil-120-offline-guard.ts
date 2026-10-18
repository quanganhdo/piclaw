import { mock } from "bun:test";
const receipt = { mode: "Bun assessment guard", networkDenied: true, childProcessDenied: true, networkAttempts: 0, childProcessAttempts: 0 };
(globalThis as any).__ADMISSION_ENFORCEMENT__ = receipt;
const network = () => { receipt.networkAttempts++; throw Error("Assessment network blocked"); };
const child = () => { receipt.childProcessAttempts++; throw Error("Assessment child process blocked"); };
globalThis.fetch = Object.assign(network, { preconnect: network }) as typeof fetch;
for (const name of ["node:http", "node:https", "node:net", "node:tls", "node:dgram"]) {
  const original = await import(name);
  const denied = { request: network, get: network, connect: network, createConnection: network, createSocket: network, createServer: network };
  mock.module(name, () => ({ ...original, ...denied, default: { ...original.default, ...denied } }));
}
const cp = await import("node:child_process");
const denied = Object.fromEntries(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"].map(name => [name, child]));
mock.module("node:child_process", () => ({ ...cp, ...denied, default: { ...cp.default, ...denied } }));
Bun.spawn = child as typeof Bun.spawn; Bun.spawnSync = child as typeof Bun.spawnSync;
Bun.connect = network as typeof Bun.connect; Bun.listen = network as typeof Bun.listen; Bun.serve = network as typeof Bun.serve;
