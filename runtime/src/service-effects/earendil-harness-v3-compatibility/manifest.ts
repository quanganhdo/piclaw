export type CompatibilityStatus = "pass" | "fail" | "unsupported";
export type RuntimeSelection = "historical" | "installed";
export type HarnessSelection = "baseline_evidence" | "rejected_evidence_only";
export type PackageInstallation = "direct" | "transitive" | "not_installed";

export interface EarendilPackageEvidence {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly shasum: string;
  readonly gitHead: string;
  readonly engine: string;
  readonly installation: PackageInstallation;
  readonly exports: readonly string[];
  readonly internalDependencies: readonly Readonly<{ name: string; range: string }>[];
}

export interface EarendilReleaseFingerprint {
  readonly package: string;
  readonly subpath: string;
  readonly kind: "runtime" | "declaration";
  readonly sha256: string;
}

export interface EarendilReleaseEvidence {
  readonly role: "historical_harness_baseline" | "current_runtime_harness_candidate";
  readonly tag: "v0.84.1" | "v0.84.4";
  readonly commit: string;
  readonly runtimeSelection: RuntimeSelection;
  readonly harnessSelection: HarnessSelection;
  readonly packages: readonly EarendilPackageEvidence[];
  readonly fingerprints: readonly EarendilReleaseFingerprint[];
  readonly conformance: Readonly<{
    caseCount: number;
    catalogueSha256: string;
    auditedResultSha256: string;
    memory: "pass" | "historical_pass";
    jsonl: "pass" | "historical_pass";
    sqlite: "unsupported";
    sqliteReason: "package_not_installed" | "bun_node_sqlite_unavailable";
  }>;
}

export interface EarendilBoundaryEvidence {
  readonly id: `EB-0${1 | 2 | 3 | 4 | 5}`;
  readonly name: string;
  readonly compileStatus: CompatibilityStatus;
  readonly runtimeStatus: CompatibilityStatus;
  readonly evidence: string;
}

export interface EarendilCapabilityEvidence {
  readonly id: `HC-0${string}`;
  readonly name: string;
  readonly requirement: string;
  readonly status: "unsupported";
  readonly operations: readonly string[];
  readonly missingExports: readonly string[];
  readonly reason: "harness_not_implemented" | "restore_not_implemented" | "missing_v3_surface" | "partial_scaffold_is_not_capability";
}

export interface HistoricalEarendilHarnessCompatibilityManifest {
  readonly schemaVersion: 2;
  readonly authority: Readonly<{
    currentRuntimeVersion: "0.84.4";
    harnessBaselineVersion: "0.84.1";
    harnessCandidateVersion: "0.84.4";
    harnessCandidateSelection: "rejected_evidence_only";
    unsupportedCountsAsPass: false;
    harnessActivation: "latent_only";
    designCommit: string;
    draftEvidenceCommit: string;
  }>;
  readonly releases: readonly EarendilReleaseEvidence[];
  readonly boundaries: readonly EarendilBoundaryEvidence[];
  readonly capabilities: readonly EarendilCapabilityEvidence[];
  readonly promotionCriteria: readonly Readonly<{ id: `PG-0${number}`; requirement: string }>[];
}

export type EarendilPublishedCandidateStatus = "partial" | "unsupported" | "unverified";

export interface EarendilPublishedCandidateCapability {
  readonly id: `HC-0${string}`;
  readonly status: EarendilPublishedCandidateStatus;
  readonly evidence: string;
}

export interface EarendilPublishedCandidateAssessment {
  readonly version: "0.87.0";
  readonly commit: "16787ad5b2dc748047f314ca1bfe7708f30f54f3";
  readonly selection: "published_candidate_not_installed";
  readonly packages: readonly EarendilPackageEvidence[];
  readonly fingerprints: readonly EarendilReleaseFingerprint[];
  readonly publicSurface: Readonly<{
    stableImports: "pass";
    executionEnvAssignment: "blocked_open_text_line_reader";
    watchSession: "runtime_slice_not_implemented";
    rawStorageConstructors: "not_exported_from_stable_session_barrel";
    streamingForkConformance: "memory_and_jsonl_pass_sqlite_pending";
    experimentalPico3: "assessed_separately_no_production_adoption";
  }>;
  readonly admissionReceipt: Readonly<{
    node: "22.19.0";
    bun: "1.4.1";
    packages: 6;
    providerFactoryCalls: 0;
    rootExports: "pass";
    sourceOnlyDeepPaths: "rejected";
    inheritedSecrets: false;
    offlineRequested: true;
    telemetry: "disabled";
    networkSandboxed: false;
  }>;
  readonly semanticReceipt: Readonly<{
    environment: "disposable_exact_0_87_0_package_family";
    tests: 28;
    assertions: 340;
    failures: 0;
    coverage: "HC-001_through_HC-023_existing_public_cases";
    evidenceLinks: "selected_exact_active_registrations_reexecuted";
  }>;
  readonly streamingForkReceipt: Readonly<{
    environment: "disposable_exact_0_87_0_package_family";
    uniqueCases: 15;
    memoryExecutions: 15;
    jsonlExecutions: 15;
    failures: 0;
    sqlite: "pending_upstream_support";
    hostOwnership: "unproved";
    caseIds: readonly string[];
  }>;
  readonly compileReceipt: Readonly<{
    status: "blocked";
    blockers: readonly Readonly<{ issue: 1377 | 1378; boundary: string }>[];
  }>;
  readonly capabilities: readonly EarendilPublishedCandidateCapability[];
  readonly promotionIssues: readonly (1377 | 1378 | 1379 | 1380 | 1381)[];
  readonly productionActivation: false;
}

export type EarendilPico3AssessmentStatus = "partial" | "unsupported" | "unverified";

export interface EarendilPico3AssessmentCase {
  readonly id: `HC-0${string}` | `PC-0${string}`;
  readonly status: EarendilPico3AssessmentStatus;
  readonly evidence: string;
}

export interface EarendilPico3ExperimentalAssessment {
  readonly version: "0.87.0";
  readonly commit: "16787ad5b2dc748047f314ca1bfe7708f30f54f3";
  readonly export: "@earendil-works/pi-agent-core/experimental/pico3";
  readonly selection: "experimental_assessment_only";
  readonly engine: ">=22.19.0";
  readonly runtimeSha256: "ce575fbbbd66e9bcb67ff0b6be483c5baefd1750cb10adaa1d73aedb9d66eafe";
  readonly declarationSha256: "1ef74b8615a31ec9eed49cfd9fa657b68958af82f1b6c480dfb40d65703a6d72";
  readonly runtimeExports: 30;
  readonly packedConsumer: Readonly<{
    node: "22.19.0";
    bun: "1.4.1";
    runtimeImports: "pass";
    declarationProbe: "pass_with_declared_optional_mcp_peer";
    closureCaveat: "google_genai_optional_peer_required_for_strict_full_dependency_check";
  }>;
  readonly implementation: Readonly<{
    durableCore: "conversations_entries_tasks_inputs_and_chord_documents";
    scheduler: "automatic_after_resume";
    storage: readonly ["MemoryStorage", "JsonlStorage"];
    sqlite: "not_implemented";
    processOwnership: "one_process_per_storage";
    watch: "snapshot_plus_binding_local_revision_bounded_256";
    chordBridge: "implemented";
    designParity: "document_contains_proposed_unexported_shapes";
  }>;
  readonly testReceipt: Readonly<{
    source: "tagged_v0_87_0_source_with_published_pi_ai_dist";
    runner: "vitest_4_1_9";
    files: 22;
    tests: 191;
    failures: 0;
  }>;
  readonly authorities: Readonly<{
    serviceWorkStore: "retained_piclaw";
    terminalSettlementStore: "retained_piclaw";
    serviceOutboxStore: "retained_piclaw";
    scheduledRunStore: "retained_piclaw";
    agentProjectionSink: "retained_piclaw";
  }>;
  readonly harnessCases: readonly EarendilPico3AssessmentCase[];
  readonly piclawCases: readonly EarendilPico3AssessmentCase[];
  readonly recommendation: Readonly<{
    disposableSpike: "go";
    productionAdoption: "no_go";
    reason: "missing_piclaw_boundary_evidence_sqlite_host_fencing_and_api_stability";
  }>;
  readonly productionImport: false;
  readonly productionActivation: false;
}

export interface EarendilHarnessCompatibilityManifest {
  readonly schemaVersion: 5;
  readonly authority: Readonly<{ currentRuntimeVersion: "0.87.1"; harnessActivation: "latent_only"; unsupportedCountsAsPass: false }>;
  readonly historical: HistoricalEarendilHarnessCompatibilityManifest;
  readonly selected: typeof SELECTED_RELEASE;
  readonly publishedCandidate: EarendilPublishedCandidateAssessment;
  readonly experimentalPico3: EarendilPico3ExperimentalAssessment;
}

export type EarendilManifestIssueCode =
  | "invalid_container"
  | "accessor_rejected"
  | "symbol_rejected"
  | "cycle_rejected"
  | "invalid_value"
  | "excessive_input"
  | "closed_shape_mismatch"
  | "manifest_drift";

export interface EarendilManifestIssue {
  readonly code: EarendilManifestIssueCode;
  readonly path: string;
  readonly message: string;
}

export type EarendilManifestNormalizationResult =
  | Readonly<{ ok: true; value: EarendilHarnessCompatibilityManifest; issues: readonly EarendilManifestIssue[] }>
  | Readonly<{ ok: false; value: null; issues: readonly EarendilManifestIssue[] }>;

const PACKAGE_NAMES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-client",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-protocol",
  "@earendil-works/pi-server",
  "@earendil-works/pi-session-backend-sqlite-node",
  "@earendil-works/pi-telemetry",
  "@earendil-works/pi-tui",
] as const;

const EXPORTS = {
  "@earendil-works/pi-agent-core": [".", "./node", "./package.json", "./session/testing"],
  "@earendil-works/pi-ai": [".", "./api/*", "./bedrock-provider", "./bun-oauth", "./compat", "./oauth", "./providers/*"],
  "@earendil-works/pi-client": [".", "./package.json", "./unix"],
  "@earendil-works/pi-coding-agent": [".", "./client", "./rpc-entry"],
  "@earendil-works/pi-protocol": ["."],
  "@earendil-works/pi-server": [".", "./testing", "./unix"],
  "@earendil-works/pi-session-backend-sqlite-node": ["."],
  "@earendil-works/pi-telemetry": [".", "./testing"],
  "@earendil-works/pi-tui": [],
} as const;

const INTERNAL_DEPENDENCIES = {
  "@earendil-works/pi-agent-core": ["@earendil-works/pi-ai", "@earendil-works/pi-telemetry"],
  "@earendil-works/pi-ai": ["@earendil-works/pi-telemetry"],
  "@earendil-works/pi-client": ["@earendil-works/pi-protocol"],
  "@earendil-works/pi-coding-agent": ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "@earendil-works/pi-client", "@earendil-works/pi-protocol", "@earendil-works/pi-tui"],
  "@earendil-works/pi-protocol": [],
  "@earendil-works/pi-server": ["@earendil-works/pi-ai", "@earendil-works/pi-protocol"],
  "@earendil-works/pi-session-backend-sqlite-node": ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai"],
  "@earendil-works/pi-telemetry": [],
  "@earendil-works/pi-tui": [],
} as const;

const PUBLICATION_COORDINATES = {
  "0.84.1": [
    ["sha512-evyzXYWCLQGmcaBYHlmSku02r8qoN4SGI60GZABo6iV+H+nqX+P9ud8fEZ4GmRq9mUSREvvfX+w9dA9ThF9C6w==", "a611675f289cba8c1404f6a4e78d26c0bb9625c7"],
    ["sha512-wMsAdJMxuNri08vLqTyYVI201DQQezGhPSTkzYsHdw5dYX3rCNwEmSvpaAwhi7ELKI/2tE/CEgSWg/6iRxSgdQ==", "e3e6318392a9f6df6fcc9040dcfafa5e5fb779f4"],
    ["sha512-/V5hGHE4Zq+jG0GtwIB9PyBUOGd6gBLZ7lkQYFKchKnxYHeH3rmWC5xw4kpnZKKBuBuFTdLVbU9vEjlAGMMb2A==", "797fb7d37191a8db82a2f81287074d6428569f69"],
    ["sha512-ncAqFrG+iybuPGOhMiZoEHkEzTpJgz3guYD32pD+M7ucc0WeHmauP6wa7qwP8V/KWvsZDVNa5XGsdZ7fkC7w7A==", "e098cada629fdeeb9df6e77c6d480d43e1b2c553"],
    ["sha512-Ox1pciyeSPGEEUcxvR0/dJcrY7C6hrEGA8y71rOsvSIUlXN1Cbp/be/eoL71OGDBk5O97TeQPfWN6Ju/2Ehjww==", "631fc198bc526af247db7fdee2fc2ce13660760a"],
    ["sha512-MTTtt7LII7bdgRkG+xuWr4NoUUywDqFXXFaN/bYqkiR4Q4aIJ3437JvsPhWg6ytB+vQjzHSGWskVpthLmTpguw==", "a4f67bdb0143b8ba3ef50b7f2af09d5a4d67a956"],
    ["sha512-yUjfCSOU0JPXOZnIRCU4ueouKqbtFRAeDJWOBk7i6GRA0d8Rqp1/9ARGNLjeB1a7L11V590kfq9tghOj5OQQJQ==", "7b1e68dc64ab210bba44924c67069db17b1a548b"],
    ["sha512-180/xGJtsq7IoR3p9EKWjRd0e9M4DkxInhlo9xyD7prDC7Qrhqq+nhvwrW0lFjPfXcEI2FSHmGCSyvSJE9GsaQ==", "c82960238c0cee896c2f7caee4c18bbf932f58c3"],
    ["sha512-udeXFbgEhJ6JiB0uguwNVNkDy2FENfmtQwPcY+/iJ8GWeq18wkal1tKqa5YyeH0IqtX1vG0cGh8zfSYzyzVuLA==", "e9f05e103a9f268d0e4911959a4fb2095b0e3889"],
  ],
  "0.84.4": [
    ["sha512-HyUnjaOXj6oN/6SNcr8A1J/ElRQA50FtIE0XUTSKAQVqmdlb9qdojOyUQwF/jULE5+yOEtGuVgi/N1RnBiNG+g==", "451e9e76b6c7fecd2a49ed5bf905f8dd6c7ce876"],
    ["sha512-AClAZxf5+c4RRu44NJPS6wyQy+Nmq+Mzyyrdvm4ZVMNuixelO02RZX4G4Aq1F145Yzp43wnM5S+hLlSI7ypfVw==", "348f1be5c2a0f4d17cc167fe1e5a7cabb191d079"],
    ["sha512-q398WY/3ZQHTizk7IKxApzqFV0xt4yM9LkSkwyqeLK5Bj5RwRjOWxESt26z4LgNp4O+8hqhqFPf/8fj4H5rE4A==", "88523ba121aea1f57bae5d67656f09af7c6fcf02"],
    ["sha512-jmOlrqUmvhh/siNWFRXjYLJzhKFIHNsAQaysRwzQPQFnPAaV/vhqHsLH/MBsIISA1Rjj7WTUFR3nJrpXoLx39w==", "3a2f04bfc5e463b4cfa36b174a586d11a0bdf9ad"],
    ["sha512-acyE9ozxkMiWiz/xyWpU0O9vwnYv0hyG889Vniv6Sg9c9zfsX+8MePnDNphBacY2Fvm1rxdsGmiVDSZl9yuDFA==", "aee0630eb3ce6844d3f68323a4a1fffc988fb0c0"],
    ["sha512-VchGLu8oMF8TjxAuPwQVdcBUSMvsdhJH5+WgKOWgeSxfgsjRJsoTQKqrambPojNuB+1MB/uWgZehq2R1sQQCUA==", "bf1e5c43310671e21d4b06ace0db3da6d91501d9"],
    ["sha512-SIYZmYm8OBVTjB4rKXHTMuE/cesFr5mYo4cxsuhds6uHc6j092k3R66Uiw53fT305TkL89SQmS8SG57CPwVYug==", "06b2eb9c435e8a61a8df626e7f65088cca9e0b3c"],
    ["sha512-8e2CuxM+ht+hedQXTZmi5JVl6/xDK9RpSDL2+MbITevKYQhMZ/z6lJOTFgox3HQyGxO8mOZEtYGVeQNaD4OzqA==", "0eefd361fab1db773496384c87bfd91be2772790"],
    ["sha512-nPUnwDkLtupPXnZQYrCwPFcuTydCDqTY6ZbFqhsL4S4kVq0AT418kPa/6uXwtaCD+MjBNBltb7ScTYX65yeE1w==", "1b5bee5f22ba90539beaddac4e4ee7ad81c8a279"],
  ],
} as const;

function packageRows(version: "0.84.1" | "0.84.4", gitHead: string): EarendilPackageEvidence[] {
  return PACKAGE_NAMES.map((name, index) => ({
    name,
    version,
    integrity: PUBLICATION_COORDINATES[version][index][0],
    shasum: PUBLICATION_COORDINATES[version][index][1],
    gitHead,
    engine: ">=22.19.0",
    installation: [0, 1, 3].includes(index)
      ? "direct"
      : [2, 4, 7, 8].includes(index)
        ? "transitive"
        : "not_installed",
    exports: [...EXPORTS[name]],
    internalDependencies: INTERNAL_DEPENDENCIES[name].map((dependency) => ({ name: dependency, range: `^${version}` })),
  }));
}

const BASELINE_FINGERPRINTS: EarendilReleaseFingerprint[] = [
  { package: PACKAGE_NAMES[0], subpath: ".", kind: "runtime", sha256: "b981a7810efdb229f2878efddf9c6e7cdb5aa20cdbf6475999aa19a04c429f60" },
  { package: PACKAGE_NAMES[0], subpath: ".", kind: "declaration", sha256: "f367678a181c02df9e779c243f452defb8b98b3b0136442471ce9b2d2b548354" },
  { package: PACKAGE_NAMES[0], subpath: "./session/testing", kind: "runtime", sha256: "e21cd63169a0e410f0671579bffdeee345a711a56ee78c12d3567bc7e63a37eb" },
  { package: PACKAGE_NAMES[0], subpath: "./session/testing", kind: "declaration", sha256: "2b6527b390774a8a82fb17dd93022caccd41f3d5b5b383dd47ab416f65c2332f" },
  { package: PACKAGE_NAMES[0], subpath: "audit:harness-scaffold", kind: "runtime", sha256: "21fdb3355adafd53c26337617a73918ba49e9832c42cde8b71c469abeecb5916" },
  { package: PACKAGE_NAMES[0], subpath: "audit:harness-scaffold", kind: "declaration", sha256: "3ceafcd72816bc8312f3f851625c082ae0b9099821fb3329e6ff9df165033472" },
  { package: PACKAGE_NAMES[1], subpath: ".", kind: "runtime", sha256: "2317a3ec8d3b0474e45d6c5cca04c71d3795c21bf83c08008c5a0869f9f33d95" },
  { package: PACKAGE_NAMES[1], subpath: ".", kind: "declaration", sha256: "9f3280dbef8435619289ea791e407fc3c2ca57748ab244d45ceb8bfdb7ea3a0e" },
  { package: PACKAGE_NAMES[3], subpath: ".", kind: "runtime", sha256: "de74c5324f2b38317eb3f9ae36ef47b41e130a4501637a0e5fce555a3e1c065b" },
  { package: PACKAGE_NAMES[3], subpath: ".", kind: "declaration", sha256: "d2d1d6fde81c8a587d57ba01774b46738923bcc42dcf1bffd4c323daf2542918" },
];

const CANDIDATE_FINGERPRINTS: EarendilReleaseFingerprint[] = [
  { package: PACKAGE_NAMES[0], subpath: ".", kind: "runtime", sha256: "aeecb12a48528008887b2391fe93ef28c18ee6aa16bf81ec9d8eff57fb0a3647" },
  { package: PACKAGE_NAMES[0], subpath: ".", kind: "declaration", sha256: "c9199d555744fcb8bc7f9166418b5905e4b1d84bd7ab56b468949a1ca97d7240" },
  { package: PACKAGE_NAMES[0], subpath: "./session/testing", kind: "runtime", sha256: "e21cd63169a0e410f0671579bffdeee345a711a56ee78c12d3567bc7e63a37eb" },
  { package: PACKAGE_NAMES[0], subpath: "./session/testing", kind: "declaration", sha256: "2b6527b390774a8a82fb17dd93022caccd41f3d5b5b383dd47ab416f65c2332f" },
  { package: PACKAGE_NAMES[0], subpath: "audit:harness-scaffold", kind: "runtime", sha256: "21fdb3355adafd53c26337617a73918ba49e9832c42cde8b71c469abeecb5916" },
  { package: PACKAGE_NAMES[0], subpath: "audit:harness-scaffold", kind: "declaration", sha256: "3ceafcd72816bc8312f3f851625c082ae0b9099821fb3329e6ff9df165033472" },
  { package: PACKAGE_NAMES[1], subpath: ".", kind: "runtime", sha256: "2317a3ec8d3b0474e45d6c5cca04c71d3795c21bf83c08008c5a0869f9f33d95" },
  { package: PACKAGE_NAMES[1], subpath: ".", kind: "declaration", sha256: "defc58571d6d5c9623e57c0dbb4db4c09687b205b539bd8b2a989377170b1799" },
  { package: PACKAGE_NAMES[3], subpath: ".", kind: "runtime", sha256: "82cb4ea864f3d8816c06bc8f2f2d9a8d82d883297af179dc69d287d042834844" },
  { package: PACKAGE_NAMES[3], subpath: ".", kind: "declaration", sha256: "fd58aa17ec9ef58367c0068c46181ae086ab2dbfe12ae744bc104b68da17d4cf" },
];

const BOUNDARIES: EarendilBoundaryEvidence[] = [
  { id: "EB-01", name: "models and credentials", compileStatus: "pass", runtimeStatus: "unsupported", evidence: "ModelRuntime and FileCredentialStore assign directly; harness prompt/deferred execution is unavailable." },
  { id: "EB-02", name: "tools and context", compileStatus: "fail", runtimeStatus: "unsupported", evidence: "Root factories and generic tools exist, but non-generic AgentHarnessOptions accepts incompatible released-v2 HarnessTool values." },
  { id: "EB-03", name: "resources and hooks", compileStatus: "fail", runtimeStatus: "unsupported", evidence: "Resources compile directly; typed v3 hook/event maps are absent and scaffold registries reject registration." },
  { id: "EB-04", name: "telemetry", compileStatus: "pass", runtimeStatus: "unsupported", evidence: "Public telemetry types and schemas compile; no harness lifecycle can emit the required evidence." },
  { id: "EB-05", name: "harness session storage and events", compileStatus: "fail", runtimeStatus: "unsupported", evidence: "Required v3 constructor/storage/usage/event exports are absent and execution/restore/watch/manual drive reject." },
];

const CAPABILITIES: EarendilCapabilityEvidence[] = [
  { id: "HC-001", name: "simple prompt", requirement: "Acceptance precedes provider effects; terminal settlement yields one result and lane.lastResult.", status: "unsupported", operations: ["prompt"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-002", name: "tool prompt", requirement: "Tool effect_pending commits before execution; tool result and final run settle once.", status: "unsupported", operations: ["prompt"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-003", name: "parallel tools", requirement: "Parallel effects may complete out of order while durable results commit in source order.", status: "unsupported", operations: ["prompt"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-004", name: "safe replay", requirement: "Restore re-executes effect_pending only when persisted and current declarations both say safe.", status: "unsupported", operations: ["create.restore"], missingExports: ["Storage", "Transaction"], reason: "restore_not_implemented" },
  { id: "HC-005", name: "never replay", requirement: "Restore settles a never-replay tool under its reserved result ID without re-execution.", status: "unsupported", operations: ["create.restore"], missingExports: ["Storage", "Transaction"], reason: "restore_not_implemented" },
  { id: "HC-006", name: "steer", requirement: "An active operation owns accepted steer until one placement transaction consumes it.", status: "unsupported", operations: ["steer"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-007", name: "follow-up", requirement: "Follow-up stays operation-owned and executes after current work according to queue mode.", status: "unsupported", operations: ["followUp"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-008", name: "next run", requirement: "Lane pendingNextRun survives cleanup and one later operation captures it once.", status: "unsupported", operations: ["nextRun"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-009", name: "abort", requirement: "Cancellation commits before signal pull; late effects cannot create a second terminal settlement.", status: "unsupported", operations: ["abort"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-010", name: "compaction", requirement: "Manual threshold and overflow compaction preserve structural preparation and result state.", status: "unsupported", operations: ["compact"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-011", name: "retry", requirement: "Captured retry policy options and attempt progression survive restore with specified effective options.", status: "unsupported", operations: ["prompt"], missingExports: [], reason: "partial_scaffold_is_not_capability" },
  { id: "HC-012", name: "suspension", requirement: "Deferred missing-identity and crash suspension report the current operation and resume safely.", status: "unsupported", operations: ["resume", "create.restore"], missingExports: [], reason: "restore_not_implemented" },
  { id: "HC-013", name: "restore", requirement: "Bounded current-register reads reconstruct open state without folding full history.", status: "unsupported", operations: ["create.restore"], missingExports: ["Storage", "Transaction"], reason: "restore_not_implemented" },
  { id: "HC-014", name: "corruption", requirement: "Invalid current-register and reference combinations fail without silent repair.", status: "unsupported", operations: [], missingExports: ["Storage", "Transaction"], reason: "missing_v3_surface" },
  { id: "HC-015", name: "lane isolation", requirement: "Operations configuration and queues do not cross named lanes.", status: "unsupported", operations: ["createLane", "lane", "lanes"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-016", name: "close", requirement: "Close writes nothing rejects new work drains admitted commits and leaves open work resumable.", status: "unsupported", operations: [], missingExports: [], reason: "partial_scaffold_is_not_capability" },
  { id: "HC-017", name: "manual drive", requirement: "Manual and automatic drive yield identical durable state while one action advances at a time.", status: "unsupported", operations: ["peekAction", "executeAction", "runToCompletion"], missingExports: [], reason: "harness_not_implemented" },
  { id: "HC-018", name: "hooks events and watch", requirement: "Typed hooks obey settlement barriers and snapshot-first buffered event ordering.", status: "unsupported", operations: ["hooks.on", "events.on", "watch", "watchSession"], missingExports: ["HarnessEventBus"], reason: "harness_not_implemented" },
  { id: "HC-019", name: "usage", requirement: "Each settled attempt has one UsageRow and totals equal the non-duplicated ledger sum.", status: "unsupported", operations: ["recordUsage"], missingExports: ["UsageRow"], reason: "missing_v3_surface" },
  { id: "HC-020", name: "deferred provider", requirement: "One poll per resume preserves handle lineage and cancel/restart outcomes.", status: "unsupported", operations: ["resume"], missingExports: [], reason: "harness_not_implemented" },
];

const PROMOTION_CRITERIA = [
  { id: "PG-01", requirement: "Select one separately approved coherent tagged Earendil package family with exact integrities." },
  { id: "PG-02", requirement: "Replace provisional negative expectations with direct assignments to the selected public types." },
  { id: "PG-03", requirement: "Run HC-001 through HC-020 against the real public constructor only." },
  { id: "PG-04", requirement: "Pass unchanged Memory and JSONL conformance plus an approved durable backend/runtime boundary." },
  { id: "PG-05", requirement: "Prove intent admission settlement restart and lane.lastResult semantics." },
  { id: "PG-06", requirement: "Prove open-operation migration backend faults precise rewrite and backup restore." },
  { id: "PG-07", requirement: "Preserve EF-S01 EF-S02 EF-S05 and EF-S08 Piclaw authority boundaries." },
  { id: "PG-08", requirement: "Pass PC golden scheduler mobile Abort SSE reconnect backup and rollback gates." },
  { id: "PG-09", requirement: "Obtain separate approval for Harness activation callers schemas and convergence." },
] as const;

const HISTORICAL_MANIFEST = {
  schemaVersion: 2,
  authority: {
    currentRuntimeVersion: "0.84.4",
    harnessBaselineVersion: "0.84.1",
    harnessCandidateVersion: "0.84.4",
    harnessCandidateSelection: "rejected_evidence_only",
    unsupportedCountsAsPass: false,
    harnessActivation: "latent_only",
    designCommit: "5f7195c51eac43cdf329f813a7ef020d7bd74527",
    draftEvidenceCommit: "fd389abc4677b4e0fa5dc9b2bbd2e63418f079b4",
  },
  releases: [
    {
      role: "historical_harness_baseline",
      tag: "v0.84.1",
      commit: "53fa77ccd8a279eb87e92294ef3687b03ff80112",
      runtimeSelection: "historical",
      harnessSelection: "baseline_evidence",
      packages: packageRows("0.84.1", "53fa77ccd8a279eb87e92294ef3687b03ff80112"),
      fingerprints: BASELINE_FINGERPRINTS,
      conformance: {
        caseCount: 29,
        catalogueSha256: "5b95af47d991cf4011f7fe42c6229779860d4ec5a5977cc16e7cf654ba170d96",
        auditedResultSha256: "03558673796deb901885963ed07be1c519990969fb8711e4b595f733b5bcfd70",
        memory: "historical_pass",
        jsonl: "historical_pass",
        sqlite: "unsupported",
        sqliteReason: "package_not_installed",
      },
    },
    {
      role: "current_runtime_harness_candidate",
      tag: "v0.84.4",
      commit: "b79e4cc834970cca69daebffab7df1da7d1e52c4",
      runtimeSelection: "installed",
      harnessSelection: "rejected_evidence_only",
      packages: packageRows("0.84.4", "b79e4cc834970cca69daebffab7df1da7d1e52c4"),
      fingerprints: CANDIDATE_FINGERPRINTS,
      conformance: {
        caseCount: 30,
        catalogueSha256: "46636aec941f7bbd5fcec6b3aec2b8e43518a0482a1b7f4fd4c1d5197e69f387",
        auditedResultSha256: "f2c7e067e69daf3e730da4dcab2a0ca14bba31be462c81aa70af0ac10b43e504",
        memory: "pass",
        jsonl: "pass",
        sqlite: "unsupported",
        sqliteReason: "bun_node_sqlite_unavailable",
      },
    },
  ],
  boundaries: BOUNDARIES,
  capabilities: CAPABILITIES,
  promotionCriteria: PROMOTION_CRITERIA,
} as const satisfies HistoricalEarendilHarnessCompatibilityManifest;

const SELECTED_RELEASE = {
  "version": "0.87.1",
  "commit": "f07218c4d4bbc12bef056a7058c3dd49dfe41abe",
  "runtimeSelection": "installed_current_loop",
  "harnessSelection": "inactive_partial_evidence",
  "packages": [
    {
      "name": "@earendil-works/chord",
      "version": "0.87.1",
      "integrity": "sha512-bg7IkJGFcEaMqqYgOGUiq5Ky9RghpRfrlZ8I/v/1b4bBZ02A7t3E+6uhPRbadwWb/kWsnVFbZsqOKRN4a3LLCg==",
      "shasum": "f983a4eae3e22c8204c53ea13070bf491330a31a",
      "gitHead": "f07218c4d4bbc12bef056a7058c3dd49dfe41abe",
      "engine": ">=22.19.0",
      "installation": "transitive",
      "exports": [
        ".",
        "./bundler",
        "./context",
        "./delta",
        "./node",
        "./package.json"
      ],
      "internalDependencies": []
    },
    {
      "name": "@earendil-works/pi-agent-core",
      "version": "0.87.1",
      "integrity": "sha512-Zev3B0HK7YS5A4EZQ2XnEqiJuirx6QBiltJ+LpmjV5a/+2IU0cfKtIfnkNkORK707XOvKBY2WRtk7cAwHpbh2Q==",
      "shasum": "bfea5c2d96dd33f8e150b7f85f693dbc72973674",
      "gitHead": "f07218c4d4bbc12bef056a7058c3dd49dfe41abe",
      "engine": ">=22.19.0",
      "installation": "direct",
      "exports": [
        ".",
        "./experimental/pico3",
        "./harness/context",
        "./harness/env/nodejs",
        "./harness/runtime/reducer",
        "./harness/session",
        "./harness/session/testing",
        "./node",
        "./package.json"
      ],
      "internalDependencies": [
        {
          "name": "@earendil-works/chord",
          "range": "^0.87.1"
        },
        {
          "name": "@earendil-works/pi-ai",
          "range": "^0.87.1"
        },
        {
          "name": "@earendil-works/pi-telemetry",
          "range": "^0.87.1"
        }
      ]
    },
    {
      "name": "@earendil-works/pi-ai",
      "version": "0.87.1",
      "integrity": "sha512-X/3PfQBnnoeVdO9Cv8zHghUMglzlgNZYGNzoPnbRoGnHl3Rw3TlA2UKSUB7BRHUOxMryHXYa8dnjWZlbRheDZA==",
      "shasum": "7d1f174120d5e6d33f301503677ec3281f217e2a",
      "gitHead": "f07218c4d4bbc12bef056a7058c3dd49dfe41abe",
      "engine": ">=22.19.0",
      "installation": "direct",
      "exports": [
        ".",
        "./api/*",
        "./bedrock-provider",
        "./bun-oauth",
        "./compat",
        "./oauth",
        "./providers/*",
        "./utils/*"
      ],
      "internalDependencies": [
        {
          "name": "@earendil-works/pi-telemetry",
          "range": "^0.87.1"
        }
      ]
    },
    {
      "name": "@earendil-works/pi-coding-agent",
      "version": "0.87.1",
      "integrity": "sha512-m8ArJUtVcQMSe1lLE/Ei7vX/JV7O39sWmWBsXV2NOU70F0qCp8GubA24pT3LnwTmM6LL2xV80/h6sQg85n69ew==",
      "shasum": "5708b9310325177d5c1b487b5c99627ffa733324",
      "gitHead": "f07218c4d4bbc12bef056a7058c3dd49dfe41abe",
      "engine": ">=22.19.0",
      "installation": "direct",
      "exports": [
        ".",
        "./client",
        "./experimental/plugin",
        "./rpc-entry"
      ],
      "internalDependencies": [
        {
          "name": "@earendil-works/chord",
          "range": "^0.87.1"
        },
        {
          "name": "@earendil-works/pi-agent-core",
          "range": "^0.87.1"
        },
        {
          "name": "@earendil-works/pi-ai",
          "range": "^0.87.1"
        },
        {
          "name": "@earendil-works/pi-tui",
          "range": "^0.87.1"
        }
      ]
    },
    {
      "name": "@earendil-works/pi-telemetry",
      "version": "0.87.1",
      "integrity": "sha512-MC6TRQH5lgMXpcN+Vku2WMI2T8BsiUPzMQHGo81uqFZD3/9O79WWJAysEDGuzduP6R4tvtgwMLwmqIxynM10JQ==",
      "shasum": "856ce8c1539d4ea24dee679f1be6e19ae353f04b",
      "gitHead": "f07218c4d4bbc12bef056a7058c3dd49dfe41abe",
      "engine": ">=22.19.0",
      "installation": "transitive",
      "exports": [
        ".",
        "./testing"
      ],
      "internalDependencies": []
    },
    {
      "name": "@earendil-works/pi-tui",
      "version": "0.87.1",
      "integrity": "sha512-YEH2vRyOeiO7hhN6j6AE6YwKSq2Kz2f3XR8bj1TbR+aGE/JsnY1hLPMI2pvaZfRM1n9Y00tejxFQ4zbzvF7nkQ==",
      "shasum": "2e3cf93fe05b7a4277855d0489e388671fcb62c2",
      "gitHead": "f07218c4d4bbc12bef056a7058c3dd49dfe41abe",
      "engine": ">=22.19.0",
      "installation": "transitive",
      "exports": [],
      "internalDependencies": []
    }
  ],
  "fingerprints": [
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": ".",
      "kind": "runtime",
      "sha256": "4a551a8b128525e90f3da827f5c459a6f6ba39796c63b2ba73d0f0bfb7be9e72"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": ".",
      "kind": "declaration",
      "sha256": "3ce94af0dcd9a9f82cdb2e6aa213222e29b42401367eb6c31c747fee02364611"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./node",
      "kind": "runtime",
      "sha256": "84c03ea93b7c4a6a656a3f560c1301ed825ca2f97ce919e16ee52bd13d88f28c"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./node",
      "kind": "declaration",
      "sha256": "eeb8d9441cb120cb5b0f86dc884e8df4c8e129a5f0a8d7d505da9a7186946686"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/context",
      "kind": "runtime",
      "sha256": "3c6f154b1fd181967991b6df371e55eb2e52e834591b56bec928805cff54b143"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/context",
      "kind": "declaration",
      "sha256": "8cddbf79a46b2b79f337d08b59049918be74d0efbdadbbf9c476c1af53e52eca"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/env/nodejs",
      "kind": "runtime",
      "sha256": "f197648dc272eb1065deb02467ebb7cc07d020ad1c30cfd8adab26dddd3ff150"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/env/nodejs",
      "kind": "declaration",
      "sha256": "8b892fd9130551cff8cf7bcf29baed12fbc3543a6f08bdb959701831df162e75"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/session",
      "kind": "runtime",
      "sha256": "fab2c9c5eb32d52e4fff468dba4c6adbe33bf3ec23bfa642eba7aa712d537ac7"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/session",
      "kind": "declaration",
      "sha256": "3deac15e45b9839c4406f522ea18f75d3f5b0953217fd84eaabe5d17a9e6cf97"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/session/testing",
      "kind": "runtime",
      "sha256": "b6603b5a993e6eb678fb49352126138556e57a3963af7e000eec03f304ab02c4"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/session/testing",
      "kind": "declaration",
      "sha256": "961fc28330bcffc231c14b3c3d3b5a247f3df9e13f6156e411dc791db152118e"
    },
    {
      "package": "@earendil-works/pi-ai",
      "subpath": ".",
      "kind": "runtime",
      "sha256": "4eee4d99e3eaf82e28826808136b2eede4184c3fb697328cbfc32db3360a8540"
    },
    {
      "package": "@earendil-works/pi-ai",
      "subpath": ".",
      "kind": "declaration",
      "sha256": "dd340daff435715950e104d1983cf013bef83c66e66b4e7b895360c1e8f4ec94"
    },
    {
      "package": "@earendil-works/pi-coding-agent",
      "subpath": ".",
      "kind": "runtime",
      "sha256": "1e3601da1e18a7be4dfdcc625d7a7fb942cc095a5d737bb1b70211af33b61e05"
    },
    {
      "package": "@earendil-works/pi-coding-agent",
      "subpath": ".",
      "kind": "declaration",
      "sha256": "1e89f64c284248e8004bc040be1b8d886f20c158091d4e466cb130fa9d13d458"
    }
  ],
  "conformance": {
    "repositoryCatalogueCount": 17,
    "memoryRepositoryCases": 17,
    "jsonlRepositoryCases": 15,
    "backendExecutions": 32,
    "catalogueAndExecutionCountChecks": 2,
    "memory": "pass",
    "jsonl": "pass",
    "storage": "not_admitted_private_constructors",
    "sqlite": "not_evaluated"
  },
  "capabilities": [
    {
      "id": "HC-001",
      "name": "simple prompt",
      "requirement": "Acceptance precedes provider effects; terminal settlement yields one result and lane.lastResult.",
      "status": "partial",
      "evidence": "accept persists operation before generation; drive settles transcript and getResult once"
    },
    {
      "id": "HC-002",
      "name": "tool prompt",
      "requirement": "Tool effect_pending commits before execution; tool result and final run settle once.",
      "status": "partial",
      "evidence": "six arguments, Piclaw authority distinct from Harness operation; awaited memo read/write/delete and late-write rejection"
    },
    {
      "id": "HC-003",
      "name": "parallel tools",
      "requirement": "Parallel effects may complete out of order while durable results commit in source order.",
      "status": "partial",
      "evidence": "parallel effects finish out of order; transcript tool results retain source order"
    },
    {
      "id": "HC-004",
      "name": "safe replay",
      "requirement": "Restore re-executes effect_pending only when persisted and current declarations both say safe.",
      "status": "partial",
      "evidence": "Public JSONL process loss at effect_pending after awaited memo writes: four persisted/current safe-never combinations; safe-safe preserves invocation/turn/operation identity, memo deletion and reserved result ID; settled third-process drive repeats neither fixture invocation nor provider call. Other crash boundaries unproved."
    },
    {
      "id": "HC-005",
      "name": "never replay",
      "requirement": "Restore settles a never-replay tool under its reserved result ID without re-execution.",
      "status": "partial",
      "evidence": "Public JSONL process loss: persisted-never or current-never prevents fixture replay, publishes one interrupted tool result at the reserved ID, and remains settled after a third-process drive. Other effects and crash points unproved."
    },
    {
      "id": "HC-006",
      "name": "steer",
      "requirement": "An active operation owns accepted steer until one placement transaction consumes it.",
      "status": "partial",
      "evidence": "queue admission, lane identity and cancellation; active-run steer crash races not proved"
    },
    {
      "id": "HC-007",
      "name": "follow-up",
      "requirement": "Follow-up stays operation-owned and executes after current work according to queue mode.",
      "status": "partial",
      "evidence": "queue admission, lane identity and cancellation; finish-boundary follow-up crash races not proved"
    },
    {
      "id": "HC-008",
      "name": "next run",
      "requirement": "Lane pendingNextRun survives cleanup and one later operation captures it once.",
      "status": "partial",
      "evidence": "nextRun consumed once by an accepted successor; process-loss retention not proved"
    },
    {
      "id": "HC-009",
      "name": "abort",
      "requirement": "Cancellation commits before signal pull; late effects cannot create a second terminal settlement.",
      "status": "partial",
      "evidence": "requestAbort uses exact operation identity; late invocation write is rejected; abort drains steer/follow-up while preserving nextRun; terminal settlement invokes no new provider effect."
    },
    {
      "id": "HC-010",
      "name": "compaction",
      "requirement": "Manual threshold and overflow compaction preserve structural preparation and result state.",
      "status": "partial",
      "evidence": "Public manual compaction after one deterministic turn writes one compaction entry and immutable result, clears the operation, and publishes ordered compaction events; unsummarized navigation publishes one result and moves to the exact target. Threshold, overflow, summarized navigation, decline and crash boundaries remain unproved."
    },
    {
      "id": "HC-011",
      "name": "retry",
      "requirement": "Captured retry policy options and attempt progression survive restore with specified effective options.",
      "status": "partial",
      "evidence": "A transient faux provider error durably enters long retry waiting; public close/reopen preserves exact operation identity/notBefore and captured policy despite changed process defaults. A separate zero-delay retry advances exactly once and settles. Exhaustion, timer-abort and structural retry variants remain unproved."
    },
    {
      "id": "HC-012",
      "name": "suspension",
      "requirement": "Deferred missing-identity and crash suspension report the current operation and resume safely.",
      "status": "partial",
      "evidence": "Deferred prompt and repeated suspension preserve exact operation/handle lineage across public repository reopen; unavailable selected model settles in band without provider execution. Other suspension causes and cancellation races remain unproved."
    },
    {
      "id": "HC-013",
      "name": "restore",
      "requirement": "Bounded current-register reads reconstruct open state without folding full history.",
      "status": "partial",
      "evidence": "Accepted-undriven operation reopens through public repository inventory and settles with one provider call; repeated drive returns the immutable result without replay. Bounded internal read counts and every durable leaf remain unproved without public raw Storage instrumentation."
    },
    {
      "id": "HC-014",
      "name": "corruption",
      "requirement": "Invalid current-register and reference combinations fail without silent repair.",
      "status": "partial",
      "evidence": "Public Session writes an incomplete lane register set referencing a missing operation; real constructor rejects while the register remains unchanged and the branch still exists. Other corruption variants unproved."
    },
    {
      "id": "HC-015",
      "name": "lane isolation",
      "requirement": "Operations configuration and queues do not cross named lanes.",
      "status": "partial",
      "evidence": "no implicit lane; atomic same-name acquire and configuration isolation"
    },
    {
      "id": "HC-016",
      "name": "close",
      "requirement": "Close writes nothing rejects new work drains admitted commits and leaves open work resumable.",
      "status": "partial",
      "evidence": "close invokes no provider; accepted-undriven operation restored from public repository"
    },
    {
      "id": "HC-017",
      "name": "manual drive",
      "requirement": "Manual and automatic drive yield identical durable state while one action advances at a time.",
      "status": "partial",
      "evidence": "Public prompt versus accept-drive for one deterministic turn produces equal role/content transcript, completed result kind/status, empty queues and one provider call. Full boundary-by-boundary state equality remains unproved."
    },
    {
      "id": "HC-018",
      "name": "hooks events and watch",
      "requirement": "Typed hooks obey settlement barriers and snapshot-first buffered event ordering.",
      "status": "partial",
      "evidence": "before_run registration order, snapshot/buffer delivery and blocked terminal hook are proved; public reduceLaneSnapshot folds one ordinary run event stream to an equal resnapshot. Navigation rebase and other interleavings remain unproved; watchSession stub remains unsupported."
    },
    {
      "id": "HC-019",
      "name": "usage",
      "requirement": "Each settled attempt has one UsageRow and totals equal the non-duplicated ledger sum.",
      "status": "partial",
      "evidence": "explicit adjustments yield stable lane/session usage totals; retry-cost provenance remains Piclaw-owned"
    },
    {
      "id": "HC-020",
      "name": "deferred provider",
      "requirement": "One poll per resume preserves handle lineage and cancel/restart outcomes.",
      "status": "partial",
      "evidence": "Faux deferred submission performs zero polls initially, exactly one poll per public resume, survives two public repository reopens, preserves operation/handle lineage, and completes without resubmission; abort cancels the exact deferred handle and settles once. Unknown-poll process loss remains unproved."
    },
    {
      "id": "HC-021",
      "name": "effect admission",
      "requirement": "Every selected Gate.admit() site proves abort-first starts nothing and admission-first receives the operation signal.",
      "status": "partial",
      "evidence": "Public abort-first prevents provider admission; admission-first starts one tool and the exact operation requestAbort flips its trailing Context abortSignal before settlement. Hook/provider/timer site coverage remains unproved because Gate is not public."
    },
    {
      "id": "HC-022",
      "name": "effect-start crash",
      "requirement": "Crash after admission but before settlement is treated as unknown and follows provider/tool/structural replay policy.",
      "status": "partial",
      "evidence": "Public JSONL process loss after awaited memo writes and a durable tool-output checkpoint at effect_pending proves safe-safe replay and never containment under stable invocation/result identity, followed by no settled replay. Provider and structural unknown-effect variants remain unproved."
    },
    {
      "id": "HC-023",
      "name": "Drive/host ownership",
      "requirement": "One lane-owned Drive serves observers; process replacement reattaches without duplicate writable authority.",
      "status": "partial",
      "evidence": "Two public same-operation drive observers return one equal result with one provider call; public close/reopen reattaches open operations. Cross-process host replacement and duplicate writable authority remain outside the in-process SessionRepo boundary."
    },
    {
      "id": "HC-024",
      "name": "storage migration",
      "requirement": "A selected storage version migrates an open operation totally and resumes after a crash at every boundary.",
      "status": "unsupported",
      "evidence": "Published 0.85.1 exposes neither built-in Memory/JSONL raw Storage constructors nor public fixture factories, so downstream open-operation migration fault injection is not supportable without private access."
    },
    {
      "id": "HC-025",
      "name": "backend/fork parity",
      "requirement": "Memory, JSONL and selected SQLite plus host ownership and streaming-fork boundaries produce specified outcomes.",
      "status": "partial",
      "evidence": "Supported public SessionRepo suites pass 17 Memory and 15 JSONL cases including fork behavior and ownership. Raw Storage, SQLite, streaming-fork parity and host-process ownership are not admitted."
    }
  ],
  "watchSession": {
    "status": "unsupported",
    "publicDeclaration": "Promise<WatchHandle<SessionSnapshot>>",
    "runtimeDeclaration": "Promise<never>",
    "runtimeError": "SliceNotImplemented"
  },
  "productionActivation": false
} as const;

const PUBLISHED_CANDIDATE = {
  "version": "0.87.0",
  "commit": "16787ad5b2dc748047f314ca1bfe7708f30f54f3",
  "selection": "published_candidate_not_installed",
  "packages": [
    {
      "name": "@earendil-works/chord",
      "version": "0.87.0",
      "integrity": "sha512-t8QOTf0GTHrsDSfcdtXuA9RCkh6mnR4l25N0SM/sgH7Ih25jH4tGXNbkGs9MWpV5xTu9MRPj4A7Zn1UEwQm9+g==",
      "shasum": "b033dc0d576114e2b36e95d3cb50f8301ddf7bfd",
      "gitHead": "16787ad5b2dc748047f314ca1bfe7708f30f54f3",
      "engine": ">=22.19.0",
      "installation": "transitive",
      "exports": [
        ".",
        "./bundler",
        "./context",
        "./delta",
        "./node",
        "./package.json"
      ],
      "internalDependencies": []
    },
    {
      "name": "@earendil-works/pi-agent-core",
      "version": "0.87.0",
      "integrity": "sha512-c5b2FMdJ7C++HBa6AyBmusdf96gdgRqpF7J+UCq2yVGB28UETJvJ190HkgDWUaLPnOQQPbanjKMAm/TgRmFE2w==",
      "shasum": "cd8ec116e33c38e2dd551030fb83654bf5ce33af",
      "gitHead": "16787ad5b2dc748047f314ca1bfe7708f30f54f3",
      "engine": ">=22.19.0",
      "installation": "direct",
      "exports": [
        ".",
        "./experimental/pico3",
        "./harness/context",
        "./harness/env/nodejs",
        "./harness/runtime/reducer",
        "./harness/session",
        "./harness/session/testing",
        "./node",
        "./package.json"
      ],
      "internalDependencies": [
        {
          "name": "@earendil-works/chord",
          "range": "^0.87.0"
        },
        {
          "name": "@earendil-works/pi-ai",
          "range": "^0.87.0"
        },
        {
          "name": "@earendil-works/pi-telemetry",
          "range": "^0.87.0"
        }
      ]
    },
    {
      "name": "@earendil-works/pi-ai",
      "version": "0.87.0",
      "integrity": "sha512-lbRm+EMY6Jx3l+HLpbqbm9Yrhkc5u7EffLk2id+zJQEoBuR5I+tijGiZU8zlnuuCclmQOgH0PVjL9PLbeqJ9MQ==",
      "shasum": "e81ec36ab4e9f44bafa2c980c7ec3cf8cda32f8d",
      "gitHead": "16787ad5b2dc748047f314ca1bfe7708f30f54f3",
      "engine": ">=22.19.0",
      "installation": "direct",
      "exports": [
        ".",
        "./api/*",
        "./bedrock-provider",
        "./bun-oauth",
        "./compat",
        "./oauth",
        "./providers/*",
        "./utils/*"
      ],
      "internalDependencies": [
        {
          "name": "@earendil-works/pi-telemetry",
          "range": "^0.87.0"
        }
      ]
    },
    {
      "name": "@earendil-works/pi-coding-agent",
      "version": "0.87.0",
      "integrity": "sha512-S9JJVGHya/h0e0M+zwPTB6RkPe7PmLLqfBUTssFYW5mxAti6oZEILn4jvaUImENRC3U9RwXAB6H4gw8xj2J0GQ==",
      "shasum": "908417741052a4ef12d9b9a8c0acb98a51ce9d87",
      "gitHead": "16787ad5b2dc748047f314ca1bfe7708f30f54f3",
      "engine": ">=22.19.0",
      "installation": "direct",
      "exports": [
        ".",
        "./client",
        "./experimental/plugin",
        "./rpc-entry"
      ],
      "internalDependencies": [
        {
          "name": "@earendil-works/chord",
          "range": "^0.87.0"
        },
        {
          "name": "@earendil-works/pi-agent-core",
          "range": "^0.87.0"
        },
        {
          "name": "@earendil-works/pi-ai",
          "range": "^0.87.0"
        },
        {
          "name": "@earendil-works/pi-tui",
          "range": "^0.87.0"
        }
      ]
    },
    {
      "name": "@earendil-works/pi-telemetry",
      "version": "0.87.0",
      "integrity": "sha512-IEUMnV6mgHyOMfAxa4CKXoBKKfHM8KxNjbXWM4Bps/iLJcFMf8hQsEZ+95VnVTc7C0cU77Rmdxt773C35jb5AA==",
      "shasum": "3d63532659b3904f784c03daa8a3fb90be8f7746",
      "gitHead": "16787ad5b2dc748047f314ca1bfe7708f30f54f3",
      "engine": ">=22.19.0",
      "installation": "transitive",
      "exports": [
        ".",
        "./testing"
      ],
      "internalDependencies": []
    },
    {
      "name": "@earendil-works/pi-tui",
      "version": "0.87.0",
      "integrity": "sha512-7gTC0XOgQfVWg4yGxwHINBpCnGl9p4KEC7PXIc8gAwc/cyxSW4VuFQrp+r1YD3oM+rBkoepKwAt6w6+VJ7BCaw==",
      "shasum": "bdfa9b094b6d59628d92c55b485b01fd281c6284",
      "gitHead": "16787ad5b2dc748047f314ca1bfe7708f30f54f3",
      "engine": ">=22.19.0",
      "installation": "transitive",
      "exports": [],
      "internalDependencies": []
    }
  ],
  "fingerprints": [
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": ".",
      "kind": "runtime",
      "sha256": "4a551a8b128525e90f3da827f5c459a6f6ba39796c63b2ba73d0f0bfb7be9e72"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": ".",
      "kind": "declaration",
      "sha256": "3ce94af0dcd9a9f82cdb2e6aa213222e29b42401367eb6c31c747fee02364611"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./node",
      "kind": "runtime",
      "sha256": "84c03ea93b7c4a6a656a3f560c1301ed825ca2f97ce919e16ee52bd13d88f28c"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./node",
      "kind": "declaration",
      "sha256": "eeb8d9441cb120cb5b0f86dc884e8df4c8e129a5f0a8d7d505da9a7186946686"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/context",
      "kind": "runtime",
      "sha256": "3c6f154b1fd181967991b6df371e55eb2e52e834591b56bec928805cff54b143"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/context",
      "kind": "declaration",
      "sha256": "8cddbf79a46b2b79f337d08b59049918be74d0efbdadbbf9c476c1af53e52eca"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/env/nodejs",
      "kind": "runtime",
      "sha256": "f197648dc272eb1065deb02467ebb7cc07d020ad1c30cfd8adab26dddd3ff150"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/env/nodejs",
      "kind": "declaration",
      "sha256": "8b892fd9130551cff8cf7bcf29baed12fbc3543a6f08bdb959701831df162e75"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/session",
      "kind": "runtime",
      "sha256": "fab2c9c5eb32d52e4fff468dba4c6adbe33bf3ec23bfa642eba7aa712d537ac7"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/session",
      "kind": "declaration",
      "sha256": "3deac15e45b9839c4406f522ea18f75d3f5b0953217fd84eaabe5d17a9e6cf97"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/session/testing",
      "kind": "runtime",
      "sha256": "b6603b5a993e6eb678fb49352126138556e57a3963af7e000eec03f304ab02c4"
    },
    {
      "package": "@earendil-works/pi-agent-core",
      "subpath": "./harness/session/testing",
      "kind": "declaration",
      "sha256": "961fc28330bcffc231c14b3c3d3b5a247f3df9e13f6156e411dc791db152118e"
    },
    {
      "package": "@earendil-works/pi-ai",
      "subpath": ".",
      "kind": "runtime",
      "sha256": "4eee4d99e3eaf82e28826808136b2eede4184c3fb697328cbfc32db3360a8540"
    },
    {
      "package": "@earendil-works/pi-ai",
      "subpath": ".",
      "kind": "declaration",
      "sha256": "dd340daff435715950e104d1983cf013bef83c66e66b4e7b895360c1e8f4ec94"
    },
    {
      "package": "@earendil-works/pi-coding-agent",
      "subpath": ".",
      "kind": "runtime",
      "sha256": "1e3601da1e18a7be4dfdcc625d7a7fb942cc095a5d737bb1b70211af33b61e05"
    },
    {
      "package": "@earendil-works/pi-coding-agent",
      "subpath": ".",
      "kind": "declaration",
      "sha256": "1e89f64c284248e8004bc040be1b8d886f20c158091d4e466cb130fa9d13d458"
    }
  ],
  "publicSurface": {
    "stableImports": "pass",
    "executionEnvAssignment": "blocked_open_text_line_reader",
    "watchSession": "runtime_slice_not_implemented",
    "rawStorageConstructors": "not_exported_from_stable_session_barrel",
    "streamingForkConformance": "memory_and_jsonl_pass_sqlite_pending",
    "experimentalPico3": "assessed_separately_no_production_adoption"
  },
  "admissionReceipt": {
    "node": "22.19.0",
    "bun": "1.4.1",
    "packages": 6,
    "providerFactoryCalls": 0,
    "rootExports": "pass",
    "sourceOnlyDeepPaths": "rejected",
    "inheritedSecrets": false,
    "offlineRequested": true,
    "telemetry": "disabled",
    "networkSandboxed": false
  },
  "semanticReceipt": {
    "environment": "disposable_exact_0_87_0_package_family",
    "tests": 28,
    "assertions": 340,
    "failures": 0,
    "coverage": "HC-001_through_HC-023_existing_public_cases",
    "evidenceLinks": "selected_exact_active_registrations_reexecuted"
  },
  "streamingForkReceipt": {
    "environment": "disposable_exact_0_87_0_package_family",
    "uniqueCases": 15,
    "memoryExecutions": 15,
    "jsonlExecutions": 15,
    "failures": 0,
    "sqlite": "pending_upstream_support",
    "hostOwnership": "unproved",
    "caseIds": [
      "branch fork application state (closed source) / excludes deleted/reappended and untouched application lists",
      "branch fork application state (closed source) / excludes overwritten and unchanged application values",
      "branch fork application state (open source) / excludes deleted/reappended and untouched application lists",
      "branch fork application state (open source) / excludes overwritten and unchanged application values",
      "fork application lists (closed source) / tree fork continues asc pagination using source cursors",
      "fork application lists (closed source) / tree fork continues desc pagination using source cursors",
      "fork application lists (closed source) / tree fork copies lists at distinct addresses",
      "fork application lists (closed source) / tree fork copies only survivors after list deletion and reappend",
      "fork application lists (closed source) / tree fork preserves list element sequences including gaps",
      "fork application lists (open source) / tree fork continues asc pagination using source cursors",
      "fork application lists (open source) / tree fork continues desc pagination using source cursors",
      "fork application lists (open source) / tree fork copies lists at distinct addresses",
      "fork application lists (open source) / tree fork copies only survivors after list deletion and reappend",
      "fork application lists (open source) / tree fork preserves list element sequences including gaps",
      "fork lane validation / ignores malformed unrelated lanes"
    ]
  },
  "compileReceipt": {
    "status": "blocked",
    "blockers": [
      {
        "issue": 1377,
        "boundary": "TranscriptContext and transcript-declared tool state replace pre-0.86 provider context fields."
      },
      {
        "issue": 1378,
        "boundary": "ExecutionEnv requires openTextLineReader across current, SSH and fake adapters."
      }
    ]
  },
  "capabilities": [
    {
      "id": "HC-001",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-002",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-003",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-004",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-005",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-006",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-007",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-008",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-009",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-010",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-011",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-012",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-013",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-014",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-015",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-016",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-017",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-018",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-019",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-020",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-021",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-022",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-023",
      "status": "partial",
      "evidence": "The existing deterministic public-boundary cases passed under the disposable exact 0.87.0 package family; the selected 0.85.1 unproved remainder still applies."
    },
    {
      "id": "HC-024",
      "status": "unsupported",
      "evidence": "The stable harness/session barrel still exports neither MemoryStorage nor JsonlStorage, so downstream raw Storage migration fault injection remains unsupported without private imports."
    },
    {
      "id": "HC-025",
      "status": "partial",
      "evidence": "Public 0.87.0 streaming-fork conformance passes 15 Memory and 15 JSONL executions across 15 unique application-list, branch-state and malformed-lane cases. SQLite streaming-fork support and cross-process host ownership remain unproved."
    }
  ],
  "promotionIssues": [
    1377,
    1378,
    1379,
    1380,
    1381
  ],
  "productionActivation": false
} as const satisfies EarendilPublishedCandidateAssessment;


const EXPERIMENTAL_PICO3 = {
  "version": "0.87.0",
  "commit": "16787ad5b2dc748047f314ca1bfe7708f30f54f3",
  "export": "@earendil-works/pi-agent-core/experimental/pico3",
  "selection": "experimental_assessment_only",
  "engine": ">=22.19.0",
  "runtimeSha256": "ce575fbbbd66e9bcb67ff0b6be483c5baefd1750cb10adaa1d73aedb9d66eafe",
  "declarationSha256": "1ef74b8615a31ec9eed49cfd9fa657b68958af82f1b6c480dfb40d65703a6d72",
  "runtimeExports": 30,
  "packedConsumer": {
    "node": "22.19.0",
    "bun": "1.4.1",
    "runtimeImports": "pass",
    "declarationProbe": "pass_with_declared_optional_mcp_peer",
    "closureCaveat": "google_genai_optional_peer_required_for_strict_full_dependency_check"
  },
  "implementation": {
    "durableCore": "conversations_entries_tasks_inputs_and_chord_documents",
    "scheduler": "automatic_after_resume",
    "storage": [
      "MemoryStorage",
      "JsonlStorage"
    ],
    "sqlite": "not_implemented",
    "processOwnership": "one_process_per_storage",
    "watch": "snapshot_plus_binding_local_revision_bounded_256",
    "chordBridge": "implemented",
    "designParity": "document_contains_proposed_unexported_shapes"
  },
  "testReceipt": {
    "source": "tagged_v0_87_0_source_with_published_pi_ai_dist",
    "runner": "vitest_4_1_9",
    "files": 22,
    "tests": 191,
    "failures": 0
  },
  "authorities": {
    "serviceWorkStore": "retained_piclaw",
    "terminalSettlementStore": "retained_piclaw",
    "serviceOutboxStore": "retained_piclaw",
    "scheduledRunStore": "retained_piclaw",
    "agentProjectionSink": "retained_piclaw"
  },
  "harnessCases": [
    {
      "id": "HC-001",
      "status": "partial",
      "evidence": "send/requestId persists one input and generation task before provider execution; terminal input/entry outcome is retained."
    },
    {
      "id": "HC-002",
      "status": "partial",
      "evidence": "tool tasks persist the finalized call and replay checkpoint before invocation, then append one result and join through post_tools."
    },
    {
      "id": "HC-003",
      "status": "partial",
      "evidence": "parallel tool tasks settle independently and post_tools joins their terminal outcomes in source-call order."
    },
    {
      "id": "HC-004",
      "status": "partial",
      "evidence": "reopened safe tools replay only when persisted and current declarations both remain safe."
    },
    {
      "id": "HC-005",
      "status": "partial",
      "evidence": "reopened unsafe tools synthesize an interrupted result and do not invoke the external tool again."
    },
    {
      "id": "HC-006",
      "status": "partial",
      "evidence": "busy input with whenBusy=steer is durably queued and placed at a post-tools/final boundary."
    },
    {
      "id": "HC-007",
      "status": "partial",
      "evidence": "busy follow-up input is durably queued and placed at an eligible final boundary."
    },
    {
      "id": "HC-008",
      "status": "unsupported",
      "evidence": "The exported SendInput supports steer/followUp/reject only; no next-run queue mode is implemented."
    },
    {
      "id": "HC-009",
      "status": "partial",
      "evidence": "task abort marks persist before invocation cancellation; scheduler joins run execution before the abort closure settles."
    },
    {
      "id": "HC-010",
      "status": "partial",
      "evidence": "manual/threshold/overflow collapse uses durable tasks, captured prefixes, retries and atomic summary/head publication."
    },
    {
      "id": "HC-011",
      "status": "partial",
      "evidence": "generation and collapse retries persist attempt policy, retry timestamp and attempt progression."
    },
    {
      "id": "HC-012",
      "status": "partial",
      "evidence": "deferred provider handles and poll times are durable; reopen resumes polling and abort performs best-effort cancellation."
    },
    {
      "id": "HC-013",
      "status": "partial",
      "evidence": "Memory/JSONL reopen restores pending/running tasks, documents, inputs and exact referenced entries without task-history folding."
    },
    {
      "id": "HC-014",
      "status": "partial",
      "evidence": "atomicity, hardening and JSONL recovery tests reject malformed or incomplete committed state rather than repairing silently."
    },
    {
      "id": "HC-015",
      "status": "partial",
      "evidence": "conversation scope checks, ownership subtrees, namespace tokens and one owning Session per Storage enforce in-process isolation."
    },
    {
      "id": "HC-016",
      "status": "partial",
      "evidence": "suspend joins local invocations and closes storage without terminalizing durable tasks; reopen resumes them."
    },
    {
      "id": "HC-017",
      "status": "unsupported",
      "evidence": "The published implementation auto-dispatches after resume(); it does not expose the explicit gated/manual drive contract required by HC-017."
    },
    {
      "id": "HC-018",
      "status": "partial",
      "evidence": "typed hooks, snapshot-first watches, bounded buffering and commit-granular envelopes are implemented and tested."
    },
    {
      "id": "HC-019",
      "status": "partial",
      "evidence": "provider/tool usage is persisted in strict-JSON entries and outcomes, but no independent UsageRow ledger/totals parity is proved."
    },
    {
      "id": "HC-020",
      "status": "partial",
      "evidence": "deferred handles survive reopen with explicit polling and cancellation behavior."
    },
    {
      "id": "HC-021",
      "status": "unsupported",
      "evidence": "Pico3 uses committed in-flight checkpoints and invocation leases but has no Gate.admit primitive or site-completeness evidence."
    },
    {
      "id": "HC-022",
      "status": "partial",
      "evidence": "in-flight checkpoints distinguish unknown provider/tool/process outcomes and apply kind-specific retry, adoption or interruption policy."
    },
    {
      "id": "HC-023",
      "status": "partial",
      "evidence": "one scheduler invocation claim owns each task in process; duplicate writable cross-process authority is outside the implementation."
    },
    {
      "id": "HC-024",
      "status": "unsupported",
      "evidence": "No storage-version migration surface, SQLite backend or open-operation migration fault suite is exported."
    },
    {
      "id": "HC-025",
      "status": "partial",
      "evidence": "Memory and JSONL history/reopen tests pass; SQLite, migration and cross-process host ownership are absent."
    }
  ],
  "piclawCases": [
    {
      "id": "PC-001",
      "status": "unverified",
      "evidence": "Ordinary accepted message: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-002",
      "status": "unverified",
      "evidence": "Exact steer: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-003",
      "status": "unverified",
      "evidence": "Stale steer: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-004",
      "status": "unverified",
      "evidence": "Exact cancellation: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-005",
      "status": "unverified",
      "evidence": "Stale cancellation: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-006",
      "status": "unverified",
      "evidence": "Late completion after cancellation: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-007",
      "status": "unverified",
      "evidence": "Terminal commit fault matrix: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-008",
      "status": "unverified",
      "evidence": "Restart with open run: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-009",
      "status": "unverified",
      "evidence": "Pending steer restart: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-010",
      "status": "unverified",
      "evidence": "Protected hand-off: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-011",
      "status": "unverified",
      "evidence": "Mutation containment: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-012",
      "status": "unverified",
      "evidence": "Scheduler agent task: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-013",
      "status": "unverified",
      "evidence": "Scheduler shell task: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-014",
      "status": "unverified",
      "evidence": "Stale SSE generation: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-015",
      "status": "unverified",
      "evidence": "Mobile Abort: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-016",
      "status": "unverified",
      "evidence": "Protected evidence: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-017",
      "status": "unverified",
      "evidence": "Maintenance failure: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-018",
      "status": "unverified",
      "evidence": "Trusted internal input: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-019",
      "status": "unverified",
      "evidence": "Cross-session steer: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    },
    {
      "id": "PC-020",
      "status": "unverified",
      "evidence": "Goal/checkpoint race: Pico3 self-tests do not execute Piclaw ServiceWorkStore, TerminalSettlementStore, ServiceOutboxStore, ScheduledRunStore or AgentProjectionSink boundaries."
    }
  ],
  "recommendation": {
    "disposableSpike": "go",
    "productionAdoption": "no_go",
    "reason": "missing_piclaw_boundary_evidence_sqlite_host_fencing_and_api_stability"
  },
  "productionImport": false,
  "productionActivation": false
} as const satisfies EarendilPico3ExperimentalAssessment;


const RAW_MANIFEST = {
  schemaVersion: 5,
  authority: { currentRuntimeVersion: "0.87.1", harnessActivation: "latent_only", unsupportedCountsAsPass: false },
  historical: HISTORICAL_MANIFEST,
  selected: SELECTED_RELEASE,
  publishedCandidate: PUBLISHED_CANDIDATE,
  experimentalPico3: EXPERIMENTAL_PICO3,
} as const satisfies EarendilHarnessCompatibilityManifest;

const CANONICAL_MANIFEST = deepFreeze(RAW_MANIFEST);

interface SnapshotState {
  nodes: number;
  readonly ancestors: object[];
  readonly issues: EarendilManifestIssue[];
}

/** Descriptor-safe exact normalization. It never invokes candidate accessors. */
export function normalizeEarendilHarnessCompatibilityManifest(candidate: unknown): EarendilManifestNormalizationResult {
  const state: SnapshotState = { nodes: 0, ancestors: [], issues: [] };
  const snapshot = snapshotData(candidate, "$", 0, state);
  if (state.issues.length > 0 || snapshot === INVALID) return failed(state.issues);
  const difference = firstDifference(snapshot, RAW_MANIFEST, "$");
  if (difference) {
    return failed([issue(difference.shape ? "closed_shape_mismatch" : "manifest_drift", difference.path, difference.message)]);
  }
  return Object.freeze({
    ok: true,
    value: CANONICAL_MANIFEST,
    issues: Object.freeze([]),
  });
}

const INVALID = Symbol("invalid-manifest-value");
const MAX_DEPTH = 20;
const MAX_NODES = 20_000;
const MAX_ARRAY_LENGTH = 2_000;
const MAX_RECORD_FIELDS = 200;
const MAX_STRING_LENGTH = 20_000;

function snapshotData(value: unknown, path: string, depth: number, state: SnapshotState): unknown | typeof INVALID {
  state.nodes += 1;
  if (state.nodes > MAX_NODES || depth > MAX_DEPTH) {
    state.issues.push(issue("excessive_input", path, "Manifest input exceeds deterministic size or depth bounds."));
    return INVALID;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value;
    state.issues.push(issue("excessive_input", path, "Manifest string exceeds the deterministic length bound."));
    return INVALID;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    state.issues.push(issue("invalid_value", path, "Manifest numbers must be finite."));
    return INVALID;
  }
  if (!value || typeof value !== "object") {
    state.issues.push(issue("invalid_value", path, "Manifest values must be JSON-domain data."));
    return INVALID;
  }
  if (state.ancestors.includes(value)) {
    state.issues.push(issue("cycle_rejected", path, "Cyclic manifest input is rejected."));
    return INVALID;
  }

  let descriptors: PropertyDescriptorMap;
  let prototype: object | null;
  let array: boolean;
  try {
    array = Array.isArray(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    prototype = Object.getPrototypeOf(value);
  } catch (error) {
    void error;
    state.issues.push(issue("invalid_container", path, "Manifest container reflection failed."));
    return INVALID;
  }
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    state.issues.push(issue("invalid_container", path, "Manifest containers must be plain records or arrays."));
    return INVALID;
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) {
    state.issues.push(issue("symbol_rejected", path, "Symbol fields are outside the closed manifest shape."));
    return INVALID;
  }
  if (keys.some((key) => {
    const descriptor = descriptors[key];
    return !descriptor || !("value" in descriptor);
  })) {
    state.issues.push(issue("accessor_rejected", path, "Accessor fields are rejected without invocation."));
    return INVALID;
  }

  state.ancestors.push(value);
  try {
    if (array) return snapshotArray(descriptors, path, depth, state);
    return snapshotRecord(descriptors, path, depth, state);
  } finally {
    state.ancestors.pop();
  }
}

function snapshotArray(descriptors: PropertyDescriptorMap, path: string, depth: number, state: SnapshotState): unknown | typeof INVALID {
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_LENGTH) {
    state.issues.push(issue("excessive_input", path, "Manifest arrays must have a bounded safe-integer length."));
    return INVALID;
  }
  const keys = Object.keys(descriptors);
  if (keys.some((key) => key !== "length" && !/^(0|[1-9]\d*)$/.test(key))) {
    state.issues.push(issue("invalid_container", path, "Manifest arrays may contain only canonical indexes."));
    return INVALID;
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) {
      state.issues.push(issue("invalid_container", `${path}[${index}]`, "Sparse or accessor array indexes are rejected."));
      return INVALID;
    }
    const item = snapshotData(descriptor.value, `${path}[${index}]`, depth + 1, state);
    if (item === INVALID) return INVALID;
    output.push(item);
  }
  return output;
}

function snapshotRecord(descriptors: PropertyDescriptorMap, path: string, depth: number, state: SnapshotState): unknown | typeof INVALID {
  const keys = Object.keys(descriptors);
  if (keys.length > MAX_RECORD_FIELDS) {
    state.issues.push(issue("excessive_input", path, "Manifest record contains too many fields."));
    return INVALID;
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) {
      state.issues.push(issue("accessor_rejected", `${path}.${key}`, "Accessor fields are rejected without invocation."));
      return INVALID;
    }
    const item = snapshotData(descriptor.value, `${path}.${key}`, depth + 1, state);
    if (item === INVALID) return INVALID;
    output[key] = item;
  }
  return output;
}

interface Difference { readonly path: string; readonly message: string; readonly shape: boolean }

function firstDifference(actual: unknown, expected: unknown, path: string): Difference | null {
  if (Object.is(actual, expected)) return null;
  if (typeof actual !== typeof expected || actual === null || expected === null) {
    return { path, message: "Manifest value differs from the closed accepted evidence.", shape: false };
  }
  if (typeof actual !== "object" || typeof expected !== "object") {
    return { path, message: "Manifest scalar differs from the closed accepted evidence.", shape: false };
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    return { path, message: "Manifest container kind differs from the closed shape.", shape: true };
  }
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  if (actualKeys.join("\0") !== expectedKeys.join("\0")) {
    return { path, message: "Manifest fields, indexes, or deterministic order differ from the closed shape.", shape: true };
  }
  for (const key of expectedKeys) {
    const difference = firstDifference(
      ownDataValue(actual, key),
      ownDataValue(expected, key),
      Array.isArray(expected) ? `${path}[${key}]` : `${path}.${key}`,
    );
    if (difference) return difference;
  }
  return null;
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

function failed(issues: readonly EarendilManifestIssue[]): EarendilManifestNormalizationResult {
  return Object.freeze({ ok: false, value: null, issues: Object.freeze([...issues]) });
}

function issue(code: EarendilManifestIssueCode, path: string, message: string): EarendilManifestIssue {
  return Object.freeze({ code, path, message });
}

const NORMALIZED = normalizeEarendilHarnessCompatibilityManifest(RAW_MANIFEST);
if (!NORMALIZED.ok) throw new Error("The closed Earendil compatibility manifest is invalid.");

/** Inert accepted WP-3B evidence. It cannot select or activate an Earendil release. */
export const EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST = NORMALIZED.value;
