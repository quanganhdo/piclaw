# Model pricing and workload comparisons — 5 September 2026

The workload comparison ranks frontier, precursor and open-weight models for a moderate 2–3-hour day. It uses explicit task assumptions and the observed prompt-cache proportions. Rankings are editorial trial recommendations; prices carry source references.

## Workload comparison

- [SVG chart](workload/workload-model-rankings.svg)
- [HTML report](workload/report.html): workload rankings, task prices, monthly scenarios and plan-fit caveats
- [Inputs](workload/inputs.json): selected route prices and cache proportions
- [Scenario](workload/scenario.json): task assumptions, rankings and calculated costs
- `workload/build.ts` and `workload/chart.ts`: reproducible generators

## Pricing audit

`audit/` preserves the earlier route-pricing audit, source responses, catalogue snapshots, aggregate workload evidence, reports and generators. Its seven-day production replay addresses a different question from the moderate-use scenario. Use the workload comparison above for the purchasing recommendation.

`audit/pricing-catalogue.json` contains 1,430 unique provider/model entries. Public tariffs, catalogue-only values, native reference estimates and unpriced routes remain separate. The runtime snapshot contains 499 verified route records.

The raw Graphite fleet inventory is excluded: it supplied no request-level pricing evidence and contained operational telemetry. Pricing sources and aggregate replay evidence are included. No database, credentials or runtime configuration are included.

## Reproduce from frozen inputs

From the repository root:

```bash
bun docs/finops/2026-09-05/workload/build.ts
bun docs/finops/2026-09-05/workload/chart.ts
bun docs/finops/2026-09-05/audit/report.ts
bun docs/finops/2026-09-05/audit/verify.ts
```

`audit/update-reference.ts` regenerates the bundled runtime pricing snapshot and reference integration from the frozen pricing catalogue. It writes repository files; it does not install them or rewrite the usage ledger.

`audit/collect.ts` is the original collection script. It requires the Smith-local read-only ledger and installed catalogue paths recorded in the script. Re-running collection replaces the frozen audit outputs; it is unnecessary for report reproduction.

## Billing limits

Amounts are USD API-equivalent estimates. Subscription capacity depends on plan entitlement, rolling limits and task behaviour. Unknown cache tariffs use an explicit ordinary-input fallback. Reasoning is included in billed output once. Regional prices, tax, funding fees, tools and retries can change cash cost.
