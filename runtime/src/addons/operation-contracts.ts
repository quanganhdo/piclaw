/** Protocol-neutral operations. Policy and execution dependencies are host-owned. */
export type OperationStatus =
  | "queued"
  | "working"
  | "cancel_requested"
  | "approval_required"
  | "input_required"
  | "budget_blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "rejected";
export const TERMINAL_OPERATION_STATUSES = new Set<OperationStatus>([
  "completed",
  "failed",
  "cancelled",
  "rejected",
]);
export interface OperationPrincipal {
  addonId: string;
  principalId: string;
}
export interface OperationInput {
  target: string;
  idempotencyKey: string;
  text: string;
}
/** Returned only by trusted host policy; never deserialize from wire/model input. */
export interface OperationGrant {
  revision: string;
  target: string;
  allowedTools: string[];
  timeoutMs: number;
  maxToolCalls: number;
  parentWorkId: string | null;
}
export type OperationAdmission =
  | { decision: "allow"; grant: OperationGrant }
  | { decision: "approval_required" | "budget_blocked" | "rejected" };
export interface OperationSnapshot {
  id: string;
  target: string;
  workId: string;
  status: OperationStatus;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  output: string | null;
  reason: string | null;
}
export interface OperationRecord extends OperationSnapshot {
  addonId: string;
  principalId: string;
  idempotencyKey: string;
  inputHash: string;
  text: string;
  grant: OperationGrant;
  chatJid: string;
}
export interface OperationEvent {
  sequence: number;
  snapshot: OperationSnapshot;
}
export interface OperationExecution {
  operationId: string;
  chatJid: string;
  workId: string;
  text: string;
  principal: Readonly<OperationPrincipal>;
  grant: Readonly<OperationGrant>;
  signal: AbortSignal;
}
export interface OperationResult {
  status:
    "completed" | "failed" | "cancelled" | "input_required" | "budget_blocked";
  /** Public final text only. Never include hidden reasoning, prompts or raw tool logs. */
  output?: string;
  /** Machine-readable host reason, not arbitrary provider exception text. */
  reason?: string;
}
export interface OperationHost {
  authorize(
    principal: Readonly<OperationPrincipal>,
    target: string,
    action: "admit" | "read" | "cancel",
  ): Promise<OperationAdmission> | OperationAdmission;
  execute(input: OperationExecution): Promise<OperationResult>;
}
export class OperationAccessError extends Error {
  constructor() {
    super("Operation unavailable.");
    this.name = "OperationAccessError";
  }
}
export class OperationConflictError extends Error {
  constructor() {
    super("Operation key conflicts with a different request.");
    this.name = "OperationConflictError";
  }
}
