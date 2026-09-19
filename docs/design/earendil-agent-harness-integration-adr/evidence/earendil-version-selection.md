# Earendil version-selection constraints

Piclaw follows Earendil's type system and semantics. It does not require Earendil to preserve Piclaw compatibility or accept Piclaw-designed APIs.

## Policy

- Select an Earendil commit/package version whose public harness can satisfy Piclaw's required product behaviour.
- Import and use that version's public types directly.
- Treat compilation failures and semantic contract failures on an upgrade as normal migration work.
- Prefer deleting Piclaw compatibility code over preserving old Earendil shapes.
- Pin all Earendil packages at one exact reviewed version during migration; update them together even when this causes broad Piclaw changes.
- Do not use private deep imports to avoid upgrading or adapting.
- Do not maintain two Earendil type dialects in production or add shims solely to keep an older selected version compiling.
- Keep only Piclaw service-plane types that represent responsibilities Earendil does not own.

## Current runtime, historical baseline and Harness target

Piclaw's existing coding-agent loop selects the coherent `0.84.4` package family. This is a current-loop dependency selection: it uses the already integrated public model, tool, environment and coding-agent APIs without selecting `AgentHarness` as Piclaw's execution plane.

Released `0.84.1` remains historical baseline evidence for the exported v2 session model, action vocabulary and unsupported Harness scaffold. Tagged `0.84.4` retains that scaffold: all audited Harness operations remain unimplemented, so it is rejected as a Harness-v3 implementation even though the current loop uses its non-Harness APIs.

The old `dev`/draft #8963 observation at `d14d6b22327d545d6a253f932165b63e48d7f9c8` remains a dated [historical capture](earendil-harness-v3-assessment.md). The current loop now uses exact published 0.85.1 at `d981de1229ef899957bbe968bc8dcda02a21f477`. Its public Context/tools/lanes support positive compatibility and Memory/JSONL SessionRepo tests; session watch remains a stub. The separate pinned tip `e4c75a73222ae2c72abb5f5314fa35ee8effc508` is planning evidence only.

The versioned manifest retains 0.84.1 and 0.84.4 results under historical data, including seven negative compiler checks and 25 unsupported Harness outcomes. Selected-release direct assignments and tests target installed 0.85.1; the broader inactive catalogue records 24 partial rows and HC-024 unsupported, never full promotion. No compatibility dialect, private export workaround or tip-only API is introduced. See [A/B/C/D scope and gates](earendil-0851-work-sequence.md).

## Upgrade workflow

For the current 0.85.1 work, PR B requires atomic direct-contract migration, basic selected positive compatibility, public Memory/JSONL SessionRepo evidence and an explicitly authorised microVM upgrade/restart/rollback receipt before merge. No production schema migration or session rewrite is intended; rollback reverts the whole runtime/dependency change to 0.84.4. Broader deterministic HC completion is PR C and later-release reassessment is PR D. Passing B does not complete or activate the Harness architecture below.

For each Harness candidate:

1. require one coherent release candidate or approved exact source and pin its complete Earendil package/source set;
2. compile Piclaw's direct imports and `satisfies` checks;
3. update local construction/context binding to the candidate's API;
4. run the applicable public SessionRepo conformance; raw Storage conformance requires supported built-in constructors or fixture factories and cannot use private fields;
5. verify the candidate exports a real public `AgentHarnessConstructor`, then run HC-001–HC-025 through it;
6. run PC-001–PC-020 and golden replay fixtures;
7. inspect semantic differences in result tags, values/lists, immutable operation results, lane-owned Drive/admission behaviour, snapshots, tools, errors and telemetry;
8. run backend/fork conformance, open-operation migration and host-ownership/process-replacement tests;
9. remove obsolete Piclaw glue; do not retain both paths;
10. record the selected version and evidence in the ADR/release review.

## Acceptable churn

The following can change on the Piclaw side without blocking adoption:

- constructor and option wiring;
- tool-context binding;
- resource loading/composition;
- event narrowing and web projection;
- session backend setup, migration, host ownership and fork policy;
- model/provider construction;
- hook registrations;
- test fixtures and expected traces;
- Piclaw modules that only existed to emulate an older Earendil API.

## Non-negotiable Piclaw responsibilities

Version churn cannot transfer these service responsibilities into an in-memory harness by accident:

- authenticated source acceptance and canonical ordering;
- Piclaw operation identity and exact cancellation authority;
- timeline/media and scheduler delivery policy;
- immutable terminal disposition and accepted-source frontier;
- external delivery idempotency;
- service restart reconciliation between Piclaw state and Earendil session state.

If a future Earendil release offers durable service features that could replace these, adopting them requires a new ADR decision based on their actual contracts. This ADR does not build a compatibility layer pre-emptively.
