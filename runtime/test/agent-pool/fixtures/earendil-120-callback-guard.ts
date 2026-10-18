/** Allows only owned synthetic loopback callback servers, never provider I/O. */
import { mock } from "bun:test";
const receipt = { externalAttempts: 0, childAttempts: 0, servers: 0, closed: 0, callbackFetches: 0 };
(globalThis as any).__CALLBACK_GUARD__ = receipt;
const allowedPorts = new Set<number>(), originalFetch = globalThis.fetch;
const originalBunServe = Bun.serve;
let ownedListen = 0;
const deny = () => { receipt.externalAttempts++; throw Error("external callback fixture I/O denied"); };
globalThis.fetch = Object.assign((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "object" && "url" in input ? input.url : String(input));
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !allowedPorts.has(Number(url.port)) || url.username || url.password) return deny();
  receipt.callbackFetches++; return originalFetch(input, { ...init, redirect: "error" });
}, { preconnect: deny }) as typeof fetch;
const http = await import("node:http");
const originalCreateServer = http.createServer;
const createServer = (...args: Parameters<typeof http.createServer>) => {
  const server = Reflect.apply(originalCreateServer, http, args), listen = server.listen; let boundPort: number | undefined;
  server.listen = function (...args: unknown[]) {
    if (args[0] !== 0 || args[1] !== "127.0.0.1") return deny();
    receipt.servers++;
    server.once("listening", () => { const a = server.address(); if (a && typeof a === "object") { boundPort = a.port; allowedPorts.add(a.port); } });
    server.once("close", () => { if (boundPort !== undefined) allowedPorts.delete(boundPort); receipt.closed++; });
    ownedListen++;
    try { return Reflect.apply(listen, server, args); }
    finally { ownedListen--; }
  } as typeof server.listen;
  return server;
};
mock.module("node:http", () => ({ ...http, createServer, request: deny, get: deny, default: { ...http.default, createServer, request: deny, get: deny } }));
for (const name of ["node:https", "node:net", "node:tls", "node:dgram"]) {
  const original = await import(name), denied = { request: deny, get: deny, connect: deny, createConnection: deny, createSocket: deny, createServer: deny };
  mock.module(name, () => ({ ...original, ...denied, default: { ...original.default, ...denied } }));
}
const child = () => { receipt.childAttempts++; throw Error("callback fixture subprocess denied"); };
const cp = await import("node:child_process"), denied = Object.fromEntries(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"].map(name => [name, child]));
mock.module("node:child_process", () => ({ ...cp, ...denied, default: { ...cp.default, ...denied } }));
Bun.spawn = child as typeof Bun.spawn; Bun.spawnSync = child as typeof Bun.spawnSync; Bun.connect = deny as typeof Bun.connect; Bun.listen = deny as typeof Bun.listen;
// Bun's node:http implementation delegates listen() to Bun.serve. Permit only
// the synchronously gated, validated owned HTTP listen above.
Bun.serve = ((...args: Parameters<typeof Bun.serve>) => {
  if (!ownedListen || args[0]?.hostname !== "127.0.0.1" || args[0]?.port !== 0) return deny();
  return Reflect.apply(originalBunServe, Bun, args);
}) as typeof Bun.serve;
