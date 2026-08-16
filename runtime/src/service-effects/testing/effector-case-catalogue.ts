import type { StandardFaultPoint } from "./fault-plan.js";

export const EFFECTOR_CONTRACT_IDS = Object.freeze([
  "EF-S01",
  "EF-S02",
  "EF-S03",
  "EF-S04",
  "EF-S05",
  "EF-S06",
  "EF-S07",
  "EF-S08",
  "EF-H01",
] as const);

export type EffectorContractId = typeof EFFECTOR_CONTRACT_IDS[number];
export type EffectorCaseId = `${EffectorContractId}-C${number}`;
export type EffectorCrashOracleId = `${EffectorContractId}-R01`;

export const SHARED_EFFECTOR_CASE_CATALOGUE = Object.freeze([
  { caseId: "shared:atomicity", description: "Partial failure cannot expose a partially committed effect." },
  { caseId: "shared:certainty", description: "Every external effect reports bounded not-applied, applied, or unknown certainty." },
  { caseId: "shared:delayed-completion", description: "A delayed or late result cannot replace a newer owner or version." },
  { caseId: "shared:idempotency", description: "Equal duplicate requests return the original result while conflicts are rejected." },
  { caseId: "shared:lease", description: "Only the current unexpired lease owner may record a worker result." },
  { caseId: "shared:owner-version", description: "Stale owner or version mutations are deterministic no-ops." },
  { caseId: "shared:redaction", description: "Protected payload values never enter traces or public projections." },
] as const);

export type SharedEffectorCase = typeof SHARED_EFFECTOR_CASE_CATALOGUE[number];
export type SharedEffectorCaseId = SharedEffectorCase["caseId"];

export interface RequiredEffectorCase {
  readonly caseId: EffectorCaseId;
  readonly description: string;
}

export interface EffectorCrashOracle {
  readonly oracleId: EffectorCrashOracleId;
  readonly description: string;
}

export interface EffectorCaseCatalogueEntry {
  readonly contractId: EffectorContractId;
  readonly interfaceName: string;
  readonly futureIssue: 972 | 973 | 974 | 975 | 976 | 977 | 978;
  readonly suiteEntryPoint: string;
  readonly prerequisites: readonly EffectorContractId[];
  readonly requiredCases: readonly RequiredEffectorCase[];
  readonly faultPoints: readonly StandardFaultPoint[];
  readonly crashOracle: EffectorCrashOracle;
  readonly sharedCaseLinks: readonly SharedEffectorCaseId[];
}

function numberedCases(
  contractId: EffectorContractId,
  descriptions: readonly string[],
): readonly RequiredEffectorCase[] {
  return Object.freeze(descriptions.map((description, index) => Object.freeze({
    caseId: `${contractId}-C${index + 1}` as EffectorCaseId,
    description,
  })));
}

function crashOracle(
  contractId: EffectorContractId,
  description: string,
): EffectorCrashOracle {
  return Object.freeze({
    oracleId: `${contractId}-R01`,
    description,
  });
}

export const EFFECTOR_CASE_CATALOGUE: readonly EffectorCaseCatalogueEntry[] = Object.freeze([
  {
    contractId: "EF-S01",
    interfaceName: "ServiceWorkStore",
    futureIssue: 975,
    suiteEntryPoint: "defineServiceWorkStoreContract",
    prerequisites: [],
    requiredCases: numberedCases("EF-S01", [
      "concurrent acceptance produces consecutive source sequences",
      "duplicate source ID returns original result for equal hash and conflict for unequal hash",
      "crash before commit leaves no source and lost acknowledgement reconciles committed source",
      "stale frontier and stale operation version are no-ops",
      "two claimers observe one operation owner",
      "exact duplicate and wrong-owner cancellation remain distinct",
      "another harness run cannot replace an existing binding",
      "queued input survives accepted queued consumed and disposed transitions",
      "restart lists every non-terminal operation",
      "dropped or duplicate wakes do not alter durable state",
    ]),
    faultPoints: [
      "before_effect", "effect_then_lost_acknowledgement", "duplicate_result", "delayed_or_late_result",
      "stale_owner_or_version", "cancellation_race", "malformed_state",
    ],
    crashOracle: crashOracle("EF-S01", "Lost acknowledgement after accept, claim, intent, cancellation, harness binding, and every queued-input edge returns the committed identity after fresh restore."),
    sharedCaseLinks: ["shared:idempotency", "shared:atomicity", "shared:owner-version", "shared:redaction"],
  },
  {
    contractId: "EF-S02",
    interfaceName: "TerminalSettlementStore",
    futureIssue: 977,
    suiteEntryPoint: "defineTerminalSettlementStoreContract",
    prerequisites: ["EF-S01", "EF-S04", "EF-S05"],
    requiredCases: numberedCases("EF-S02", [
      "rollback after every statement leaves no partial terminal state",
      "commit followed by lost acknowledgement returns original result",
      "accepted cancellation authority authorises cancellation and rejects completion",
      "stale Piclaw version chat owner and complete harness correlation are no-ops",
      "missing or duplicate media cannot create two terminal rows",
      "placeholder replacement preserves one terminal message",
      "new-row settlement preserves one terminal message",
      "outbox insertion failure rolls back disposition and timeline",
      "frontier cannot cross pending or claimed work and no projection occurs before commit",
    ]),
    faultPoints: [
      "before_effect", "effect_then_lost_acknowledgement", "acknowledgement_then_crash",
      "duplicate_result", "delayed_or_late_result", "stale_owner_or_version",
      "cancellation_race", "malformed_state",
    ],
    crashOracle: crashOracle("EF-S02", "pre-effect no-op C1 rollback evidence held-lock retry and lost-ack restore converge"),
    sharedCaseLinks: ["shared:idempotency", "shared:atomicity", "shared:redaction"],
  },
  {
    contractId: "EF-S03",
    interfaceName: "TimelineDraftStore",
    futureIssue: 972,
    suiteEntryPoint: "defineTimelineDraftStoreContract",
    prerequisites: ["EF-S04"],
    requiredCases: numberedCases("EF-S03", [
      "duplicate equal draft revision returns original write",
      "conflicting or stale revision creates no row",
      "replacement preserves row ownership and thread association",
      "later insert cannot create a second current row",
      "replacement artifacts include latest media only",
      "service notice is idempotent by source",
      "committed draft replay does not require payload availability",
      "concurrent service notices decide key and source atomically",
      "invalid content blocks are rejected",
      "stale request hash is rejected before mutation",
      "content blocks require JSON media type",
      "concurrent first inserts retain one current row",
      "concurrent equal draft returns one immutable write",
      "out-of-order replacement cannot overwrite a higher revision",
      "draft and notice rows remain non-terminal",
    ]),
    faultPoints: [
      "before_effect", "effect_then_lost_acknowledgement", "duplicate_result", "delayed_or_late_result",
      "stale_owner_or_version", "redaction_violation",
    ],
    crashOracle: crashOracle("EF-S03", "A committed replacement whose result is lost is recovered as the same non-terminal write after restore."),
    sharedCaseLinks: ["shared:idempotency", "shared:redaction"],
  },
  {
    contractId: "EF-S04",
    interfaceName: "OperationMediaStore",
    futureIssue: 972,
    suiteEntryPoint: "defineOperationMediaStoreContract",
    prerequisites: [],
    requiredCases: numberedCases("EF-S04", [
      "equal upload ID and digest returns original media reference",
      "committed media replay does not require payload availability",
      "conflicting digest is rejected",
      "equal digest with changed upload semantics is rejected",
      "operation binding is unique by operation media and role",
      "changed binding semantics conflict",
      "concurrent binding decisions are atomic",
      "stale request hash is rejected before mutation",
      "payload media type must match request content type",
      "metadata reference requires JSON media type",
      "missing media cannot be bound",
      "compressed data round trips with stable digest",
      "text-index maintenance follows media lifecycle",
      "reference arriving at delete boundary preserves upload identity",
      "deleted media preserves immutable create history",
      "mutable resolver bytes are defensively snapshotted",
      "orphan deletion is blocked by operation message or outbox reference",
    ]),
    faultPoints: [
      "before_effect", "effect_then_lost_acknowledgement", "duplicate_result", "delayed_or_late_result",
      "malformed_state", "redaction_violation",
    ],
    crashOracle: crashOracle("EF-S04", "A blob committed before operation binding remains recoverable and unbound after restore."),
    sharedCaseLinks: ["shared:idempotency", "shared:redaction"],
  },
  {
    contractId: "EF-S05",
    interfaceName: "ServiceOutboxStore",
    futureIssue: 976,
    suiteEntryPoint: "defineServiceOutboxStoreContract",
    prerequisites: [],
    requiredCases: numberedCases("EF-S05", [
      "concurrent workers claim one lease owner",
      "every pending started completed failed unknown and cancelled state edge is bounded",
      "expired repeatable work can be reclaimed by policy",
      "stale completion and failure tokens are no-ops",
      "duplicate equal intent returns original row and conflict returns error",
      "crash before effect preserves pending intent",
      "effect before acknowledgement becomes unknown until reconciliation",
      "poison payload fails without blocking bounded cleanup",
    ]),
    faultPoints: [
      "before_effect", "effect_then_lost_acknowledgement", "acknowledgement_then_crash",
      "duplicate_result", "delayed_or_late_result", "stale_owner_or_version",
      "lease_expiry", "malformed_state", "redaction_violation",
    ],
    crashOracle: crashOracle("EF-S05", "Restore distinguishes worker death after claim from death after an external effect and never auto-retries unknown work."),
    sharedCaseLinks: ["shared:idempotency", "shared:lease", "shared:redaction"],
  },
  {
    contractId: "EF-S06",
    interfaceName: "DeliveryDriver",
    futureIssue: 973,
    suiteEntryPoint: "defineDeliveryDriverContract",
    prerequisites: ["EF-S05"],
    requiredCases: numberedCases("EF-S06", [
      "before-send failure reports not_applied",
      "provider rejection and rate limit retain bounded certainty",
      "accepted then disconnected reports applied or unknown by driver capability",
      "delayed receipt is deterministic",
      "abort before send and late abort remain distinct",
      "unsupported reconciliation is omitted",
      "Web Push preserves zero all-known partial and all-failed aggregate counts",
      "mismatched payload tuples fail before boundary invocation and mutable bytes are snapshotted",
      "provider kind and caller-owned timeline or wake identity are fenced",
      "malformed Web Push aggregate is a bounded unknown boundary fault",
      "malformed typed error classifier output becomes an unknown transport failure",
      "unknown requests including hostile or changing getters, missing full AbortSignal shape, whitespace destinations, identity fields, and attempt numbers normalize once or fail before resolver/boundary",
      "semantic payload validation independently rejects a valid tuple before effect",
      "abort during awaited payload resolution consumes no attempt",
      "injected validator non-booleans/throws and classifier faults remain bounded before effect",
      "malformed timestamps, receipts, provider detail/identity and classifier tag/retry combinations stay bounded while provider certainty is derived",
      "mutable resolver bytes are defensively snapshotted before boundary observation and injected provider-specific factories preserve current timeline/channel/Web Push/Pushover/wake shapes",
    ]),
    faultPoints: [
      "before_effect", "effect_then_lost_acknowledgement", "acknowledgement_then_crash",
      "duplicate_result", "delayed_or_late_result", "cancellation_race", "redaction_violation",
    ],
    crashOracle: crashOracle("EF-S06", "A fresh stateless driver restores with no local attempt/script state after an unknown provider response; observer total remains one, no retry/reconciliation starts, and outbox policy owns the persisted outcome and later decision."),
    sharedCaseLinks: ["shared:certainty", "shared:delayed-completion", "shared:redaction"],
  },
  {
    contractId: "EF-S07",
    interfaceName: "ScheduledRunStore",
    futureIssue: 978,
    suiteEntryPoint: "defineScheduledRunStoreContract",
    prerequisites: ["EF-S01", "EF-S05"],
    requiredCases: numberedCases("EF-S07", [
      "two scheduler instances claim one occurrence",
      "pause or delete before claim prevents a run",
      "lease renewal and expiry reject stale workers",
      "source binding is idempotent and owner fenced",
      "one-shot and recurring completion persist next occurrence correctly",
      "agent shell and internal result shapes remain distinct",
      "muted notification creates no delivery intent",
      "unknown delivery does not rerun the task",
    ]),
    faultPoints: [
      "before_effect", "effect_then_lost_acknowledgement", "acknowledgement_then_crash",
      "duplicate_result", "delayed_or_late_result", "stale_owner_or_version",
      "lease_expiry", "malformed_state",
    ],
    crashOracle: crashOracle("EF-S07", "Restore after claim, source binding, or completion preserves one occurrence and one run log."),
    sharedCaseLinks: ["shared:idempotency", "shared:lease", "shared:redaction"],
  },
  {
    contractId: "EF-S08",
    interfaceName: "AgentProjectionSink",
    futureIssue: 973,
    suiteEntryPoint: "defineAgentProjectionSinkContract",
    prerequisites: ["EF-S01", "EF-S02"],
    requiredCases: numberedCases("EF-S08", [
      "snapshot precedes buffered events",
      "reconnect generation rejects stale callbacks",
      "non-increasing receipt sequence is dropped",
      "cross-chat and cross-operation identity cannot mix",
      "terminal projection requires a committed terminal reference and closes its generation",
      "protected or unknown public payload keys are rejected",
      "transport throw reports unknown without advancing the cursor",
      "malformed closed DTO values are rejected before authority and transport",
      "reconstructed sink starts without cursors and requires a fresh snapshot with trace continuity",
      "same-generation snapshot cannot reset an established cursor",
      "non-void transport return is unknown and does not advance cursor",
      "authority predicate non-booleans and faults remain bounded before transport",
      "arbitrary malformed runtime inputs including hostile/changing identity, sequence, terminal and array getters normalize to plain deeply frozen DTOs or resolve protected-payload before authority/transport",
    ]),
    faultPoints: [
      "before_effect", "effect_then_lost_acknowledgement", "duplicate_result", "delayed_or_late_result",
      "stale_owner_or_version", "malformed_state", "redaction_violation",
    ],
    crashOracle: crashOracle("EF-S08", "Reconnect between snapshot and buffered events resumes at a new generation without replaying stale callbacks."),
    sharedCaseLinks: ["shared:owner-version", "shared:redaction"],
  },
  {
    contractId: "EF-H01",
    interfaceName: "ExecutionContextResolver",
    futureIssue: 974,
    suiteEntryPoint: "defineExecutionContextResolverContract",
    prerequisites: ["EF-S01"],
    requiredCases: numberedCases("EF-H01", [
      "exact operation and version authority precedes all route profile environment and transport callbacks",
      "local and current-local selection returns a fresh immutable context for each admitted batch",
      "SSH route and profile snapshots cannot retarget admitted contexts and localEnv remains local",
      "relative canonical and symlink paths obey selected ExecutionEnv semantics",
      "every FileSystem method resolves Earendil Result and delegated rejections become typed FileError",
      "shell success nonzero and typed execution failures preserve Earendil semantics",
      "timeout abort and cleanup stop only instance-owned process groups and cleanup never rejects",
      "SSH disconnect certainty distinguishes before effect from after submission",
      "credentials remain consumed only by execution and absent from contexts metadata errors and traces",
      "hostile throwing thenable changing and malformed injected callbacks settle as bounded typed failures",
    ]),
    faultPoints: [
      "before_effect", "effect_then_lost_acknowledgement", "acknowledgement_then_crash",
      "stale_owner_or_version", "cancellation_race", "malformed_state", "redaction_violation",
    ],
    crashOracle: crashOracle("EF-H01", "SSH disconnect during an effect and restore preserve immutable routing while owned processes are cleaned up."),
    sharedCaseLinks: ["shared:owner-version", "shared:delayed-completion", "shared:redaction"],
  },
]);

export function assertCompleteEffectorCaseCatalogue(
  catalogue: readonly EffectorCaseCatalogueEntry[] = EFFECTOR_CASE_CATALOGUE,
  sharedCatalogue: readonly SharedEffectorCase[] = SHARED_EFFECTOR_CASE_CATALOGUE,
): void {
  const sharedIds = new Set<SharedEffectorCaseId>();
  for (const sharedCase of sharedCatalogue) {
    if (sharedIds.has(sharedCase.caseId)) {
      throw new Error(`Shared effector case is duplicated: ${sharedCase.caseId}`);
    }
    sharedIds.add(sharedCase.caseId);
  }

  const ids = catalogue.map((entry) => entry.contractId);
  for (const id of EFFECTOR_CONTRACT_IDS) {
    if (ids.filter((candidate) => candidate === id).length !== 1) {
      throw new Error(`Effector case catalogue must contain ${id} exactly once.`);
    }
  }
  if (ids.length !== EFFECTOR_CONTRACT_IDS.length) {
    throw new Error("Effector case catalogue contains an unknown or duplicate contract.");
  }
  const caseIds = new Set<EffectorCaseId>();
  const oracleIds = new Set<EffectorCrashOracleId>();
  for (const entry of catalogue) {
    if (entry.requiredCases.length === 0 || entry.faultPoints.length === 0 || !entry.crashOracle.description) {
      throw new Error(`Effector case catalogue entry ${entry.contractId} is incomplete.`);
    }
    for (const requiredCase of entry.requiredCases) {
      if (!requiredCase.caseId.startsWith(`${entry.contractId}-C`) || caseIds.has(requiredCase.caseId)) {
        throw new Error(`Effector case ID is misplaced or duplicated: ${requiredCase.caseId}`);
      }
      caseIds.add(requiredCase.caseId);
    }
    if (entry.crashOracle.oracleId !== `${entry.contractId}-R01` || oracleIds.has(entry.crashOracle.oracleId)) {
      throw new Error(`Effector crash oracle is misplaced or duplicated: ${entry.crashOracle.oracleId}`);
    }
    oracleIds.add(entry.crashOracle.oracleId);

    const entryLinks = new Set<SharedEffectorCaseId>();
    for (const link of entry.sharedCaseLinks) {
      if (!sharedIds.has(link)) throw new Error(`Shared effector case link is unknown: ${link}`);
      if (entryLinks.has(link)) {
        throw new Error(`Shared effector case link is duplicated for ${entry.contractId}: ${link}`);
      }
      entryLinks.add(link);
    }
  }
}
