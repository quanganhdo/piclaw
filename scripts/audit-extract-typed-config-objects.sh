#!/bin/bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
out_dir="$repo_root/artifacts/extract-typed-config-objects"
mkdir -p "$out_dir"
cd "$repo_root"

test_log="$out_dir/targeted-tests.txt"
: >"$test_log"
run_tests() {
  bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test --max-concurrency=1 "$@" \
    >>"$test_log" 2>&1
}
run_tests \
  test/config/config.test.ts \
  test/config/config-coverage-import.test.ts \
  test/remote/remote-interop.test.ts \
  test/remote/ssrf.test.ts
run_tests \
  test/agent-pool/slash-recognition.test.ts \
  test/agent-pool/manual-control-retirement.test.ts
run_tests \
  test/runtime/bootstrap.test.ts \
  test/runtime/scheduler.test.ts \
  test/ipc/ipc.test.ts
run_tests \
  test/agent-control/passkey-totp-handler.test.ts \
  test/channels/web/totp-auth.test.ts \
  test/channels/web/totp-card.test.ts \
  test/channels/web/proxy-sensitive-flows.test.ts \
  test/utils/request-client.test.ts

bare_constant_exports=$(bun -e 'const fs=require("fs"); const src=fs.readFileSync("runtime/src/core/config.ts","utf8").split(/\n/); let count=0; for (const line of src) { const m=line.match(/^export\s+(const|let)\s+([A-Z_][A-Z0-9_]*)\b/); if (m && !m[2].endsWith("_CONFIG")) count++; } console.log(count);')
remote_bare_exports=$(bun -e 'const fs=require("fs"); const src=fs.readFileSync("runtime/src/core/config.ts","utf8").split(/\n/); let count=0; for (const line of src) { const m=line.match(/^export\s+(const|let)\s+(REMOTE_[A-Z0-9_]*)\b/); if (m && !m[2].endsWith("_CONFIG")) count++; } console.log(count);')
typed_config_objects=$(bun -e 'const fs=require("fs"); const src=fs.readFileSync("runtime/src/core/config.ts","utf8").split(/\n/); let count=0; for (const line of src) { const m=line.match(/^export\s+const\s+([A-Z_][A-Z0-9_]*_CONFIG)\b/); if (m) count++; } console.log(count);')

bun -e '
  const fs = require("fs");
  const summary = {
    ticket: "workitems/10-next/extract-typed-config-objects.md",
    command: "./scripts/audit-extract-typed-config-objects.sh",
    timestamp: new Date().toISOString(),
    metrics: {
      bare_constant_exports: Number(process.argv[1]),
      remote_bare_exports: Number(process.argv[2]),
      typed_config_objects: Number(process.argv[3]),
    },
    evidence: {
      targeted_tests: "artifacts/extract-typed-config-objects/targeted-tests.txt",
    },
  };
  fs.writeFileSync("artifacts/extract-typed-config-objects/summary.json", JSON.stringify(summary, null, 2));
  fs.writeFileSync(
    "artifacts/extract-typed-config-objects/summary.md",
    [
      "# Extract typed config objects audit",
      "",
      `- Ticket: \`${summary.ticket}\``,
      `- Command: \`${summary.command}\``,
      `- Timestamp: ${summary.timestamp}`,
      `- bare_constant_exports: ${summary.metrics.bare_constant_exports}`,
      `- remote_bare_exports: ${summary.metrics.remote_bare_exports}`,
      `- typed_config_objects: ${summary.metrics.typed_config_objects}`,
      `- Targeted tests log: \`${summary.evidence.targeted_tests}\``,
    ].join("\n") + "\n"
  );
' -- "$bare_constant_exports" "$remote_bare_exports" "$typed_config_objects"

echo "METRIC bare_constant_exports=$bare_constant_exports"
echo "METRIC remote_bare_exports=$remote_bare_exports"
echo "METRIC typed_config_objects=$typed_config_objects"
