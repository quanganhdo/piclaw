import { createHash } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";

/** Only the last value installed by the host; explicit SDK configuration wins. */
export const HostManagedInstructions = defineDoc({
  kind: "app.host-managed-instructions", version: 1, scope: "conversation",
  history: "latest", fork: "initial", checkpointWhen: () => false, initial: () => ({ managedHash: null as string | null }),
});

export const instructionHash = (instructions: string) => createHash("sha256").update(instructions).digest("hex");

export function shouldManageInstructions(instructions: string | undefined, managedHash: string | null | undefined): boolean {
  return managedHash == null ? !instructions : instructions !== undefined && instructionHash(instructions) === managedHash;
}
