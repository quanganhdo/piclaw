# Native host composition

`AgentPool` requires a callable `getDurableSession` lookup for native construction. Its scope is exhaustive: an empty lookup remains native and cannot choose a legacy session factory. Missing lookup rejects construction. Explicit `legacyCapture: true` selects the historical resident-capture/resource composition; it cannot coexist with native lookup. Production backend preparation supplies native ports. Only internal migration inspection requests capture composition through bootstrap.

## Native services

`service-factory.ts` returns shared attachments, native control/report/model/auth facade, host branch metadata and MCP configuration inspection. It does not construct or return a legacy session manager, session binder, tool factory, turn tracker, prewarm/replay controller or fake lifecycle implementation. No placeholder tool/session/binder methods or fabricated manager counters stand in for native ownership.

Root SDK definitions/settings/resources, credential/model runtime/catalogue and host restrictions remain real dependencies. They do not create an AgentSession. Native requests, grants, budgets, tool effects, maintenance and terminal settlement belong to the application backend. Native MCP transport/client/credential closure belongs to `runtime/durable-engine/src/host-mcp.ts`, not the legacy session-pool manager.

Host branch metadata remains independently useful. Native composition supplies no get/create, refresh or warmup callbacks to its branch service. Unsupported native branch mutations remain rejected at their existing authority boundaries. Database-only root creation/rename/archive/restore retain their owner and exact-binding guards.

## Lifecycle

The legacy idle eviction/pressure/forced-GC timer runs only with a real explicit capture/resource manager. Native construction installs no such timer. Native shutdown does not call an empty legacy shutdown object; the application backend joins its actual owned resources before releasing the global owner.

Startup warmup environment controls, AgentPool warmup methods and branch-endpoint prewarm handling are deleted. Stale HTTP query parameters confer no hydration authority and do not alter the branch response. SDK sessions needed for historical capture must already be selected by the explicit owner; a prewarm queue cannot invent that selection.

Native host memory snapshots omit legacy session-manager instrumentation; the web legacy-pool metric projection returns unavailable rather than synthetic zeroes. This does not claim that broader native UI/persistence projection retirement (#1691/#1692) is complete.

## MCP configuration boundary

Read/preview remains available through the existing owner-only, no-store API. Without a real legacy transition owner, `applyAvailable` is false and `runtime.observedPolicy` is null. Both Apply routes reject with409 before persistence or activation. Empty legacy session snapshots cannot certify native shutdown/reload or report a new native configuration as observed.

The native MCP owner captures startup configuration and invalidates itself on source/policy changes. Replacing that startup-owned context requires an explicit lifecycle operation; this composition change does not add hot replacement, restart the service or infer permission for an operational action. Existing settings panes already consume capability/observed-policy fields, so no parallel state surface is introduced.

The historical controller with a real session manager remains separately tested at the explicit capture/resource boundary. Its acknowledged shutdown/reload, quarantine, credential and revision checks are unchanged. Those legacy-controller tests do not certify native live reconfiguration.

## Historical capture

`captureLegacyUpgradeBindings` is a deliberate lazy entry. Native host instances reject it and `assertLegacyCaptureIdle` because they have no resident legacy authority. The explicit capture composition retains synchronous quiescence checks and detaches original source selection/baselines before its first filesystem await. Capture/import preserves aliases, source bytes, selected public SDK heads, provenance, immutable host baseline, queue/owner certificates and revalidation; it does not prompt, retry, rotate files or migrate live state as part of ordinary startup.

## Evidence

- Fresh-process native import/construction fences for both bound and empty scopes; explicit capture selection separately reaches its legacy fence.
- `native-host-services.test.ts`: lifecycle object absence, missing/mixed authority denial, no native GC timer/capture certificate/fake manager metrics, and MCP Apply refusal with unchanged config/DB.
- Native controls/auth/catalogue and actual MCP config-change/uncertain-close/concurrent-call cases; SDK budget/source admission and owner-retaining shutdown remain separate application tests.
- `runtime-upgrade-workflow.test.ts`: actual capture→owned upgrade across all22 scenarios, plus retained resident alias/baseline/source race tests.

No dependency upgrade, deployment, restart, credential operation, live schema/history cleanup or repeat migration is included.
