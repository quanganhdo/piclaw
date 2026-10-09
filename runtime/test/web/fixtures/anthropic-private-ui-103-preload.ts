import assert from "node:assert/strict";
import { readFileSync, readlinkSync } from "node:fs";
assert.ok(process.versions.bun);
assert.ok(process.env.SYNTHETIC_PARENT_NETNS);
assert.notEqual(readlinkSync("/proc/self/ns/net"), process.env.SYNTHETIC_PARENT_NETNS, "A distinct network namespace is required.");
assert.deepEqual(readFileSync("/proc/net/dev", "utf8").trim().split("\n").slice(2).map(line => line.split(":")[0].trim()), ["lo"]);
assert.equal(readFileSync("/proc/net/route", "utf8").trim().split("\n").length, 1);
assert.equal(process.getuid?.(), Number(process.env.SYNTHETIC_EXPECT_UID)); assert.notEqual(process.getuid?.(), 0);
const status = readFileSync("/proc/self/status", "utf8");
for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) assert.match(status, new RegExp(`${field}:\\s+0{16}(?:\\n|$)`));
assert.match(status, /NoNewPrivs:\s+1(?:\n|$)/); assert.match(status, /Groups:\s*\n/);
// Runs before the SDK and test modules. Individual cases replace this guard only
// with exact endpoint/payload assertions; the namespace independently denies egress.
const guard = { unexpectedRequests: 0 };
Object.assign(globalThis, { __anthropicUiGuard: guard });
const deny = () => { guard.unexpectedRequests++; throw new Error("Unexpected private UI fixture network."); };
globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch;
