#!/usr/bin/env bun
import { applyHistoricalAccountCopy, prepareHistoricalAccountCopy } from "./lib/historical-account-copies.js";

const [command, first, second, ...extra] = process.argv.slice(2);
try {
  if (!first || !second || extra.length || (command !== "prepare" && command !== "apply"))
    throw Error("Usage: retire-historical-accounts.ts prepare <explicit-offline-copy.db> <new-private-directory> | apply <private-directory> <approved-plan-sha256>");
  const result = command === "prepare" ? prepareHistoricalAccountCopy(first, second) : applyHistoricalAccountCopy(first, second);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Historical retirement refused");
  process.exitCode = 1;
}
