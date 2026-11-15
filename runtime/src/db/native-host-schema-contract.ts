import { createHash } from "node:crypto";

// Shared declaration only: host-schema applies this step under its owner guard;
// legacy capture permits exactly this candidate index/receipt during upgrade.
export const nativeBindingRecoveryIndex = "idx_piclaw_durable_bindings_payload_recovery_v1";
export const nativeBindingRecoveryMigration = Object.freeze({
  owner: "host.native-bindings", id: "accepted-payload-index-v1", order: 1,
  sql: `CREATE INDEX IF NOT EXISTS ${nativeBindingRecoveryIndex}
  ON piclaw_durable_bindings_v1(incarnation,chat_jid,source_id,payload_ref)`,
});
export const nativeBindingRecoveryChecksum = createHash("sha256").update(nativeBindingRecoveryMigration.sql).digest("hex");
