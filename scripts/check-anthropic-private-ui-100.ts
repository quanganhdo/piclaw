#!/usr/bin/env bun
/** Explicit opt-in: disposable server/profile and public built-in OAuth, never a live target. */
import { readlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runLocalTestCommand } from "../runtime/scripts/local-test-priority.js";

if (process.env.PICLAW_RUN_ANTHROPIC_PRIVATE_UI_TESTS !== "1" || process.env.PICLAW_E2E_DISPOSABLE !== "1") {
  throw new Error("Explicit disposable Anthropic private-UI qualification flags are required.");
}
const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
if (!browsers) throw new Error("An installed PLAYWRIGHT_BROWSERS_PATH is required.");
const repo = resolve(import.meta.dir, "..");
const command = `import {runLocalTestCommand} from "./runtime/scripts/local-test-priority.ts"; await runLocalTestCommand(${JSON.stringify([
  process.execPath, "runtime/scripts/controlled-test-runner.ts", "--", "--preload", "./test/web/fixtures/anthropic-private-ui-100-preload.ts",
  "test/web/anthropic-private-ui-100.playwright.optional.test.ts", ...process.argv.slice(2),
])});`;
await runLocalTestCommand(["sudo", "-n", "unshare", "--net", "/bin/sh", "-c",
  'ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent PICLAW_RUN_ANTHROPIC_PRIVATE_UI_TESTS=1 PICLAW_E2E_DISPOSABLE=1 PLAYWRIGHT_BROWSERS_PATH="$4" PI_OFFLINE=1 PI_TELEMETRY=0 OTEL_SDK_DISABLED=true SYNTHETIC_PARENT_NETNS="$5" SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=3s 420s "$6" --no-env-file -e "$7"',
  "anthropic-private-ui", String(process.getuid?.()), String(process.getgid?.()), `${dirname(process.execPath)}:/usr/bin:/bin`, resolve(browsers),
  readlinkSync("/proc/self/ns/net"), process.execPath, command,
], { cwd: repo });
