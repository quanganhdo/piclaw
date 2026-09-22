# Model state API wiring after a forced refresh

Classic's application API adapter omitted `getAgentModelState`. The production entrypoint destructured that missing export and passed `undefined` into the model refresh hook. This left model and thinking labels empty after a cold load and stopped their periodic refresh, even when `/agent/status?ui=1` returned valid data.

## Cause and correction

`app.ts` uses the compact snapshot reader through `appApi`. `resolveAppApiSurface` exposed the full catalogue reader, `getAgentModels`, but did not expose `getAgentModelState`. Calling the missing function rejected the refresh's `Promise.all` before model or context results could be applied. The catch preserved previous state, hiding the wiring error. Independent context refresh and SSE handlers could still update context; this defect does not imply that all status events stopped.

The correction adds the missing reader to the adapter. It changes no polling intervals, backend endpoints, model selections or thinking policy. The previous reconciliation changes in #1389 are retained.

## Regression coverage

The #1389 tests injected model readers directly into the lifecycle hook. They bypassed the application API adapter and could not catch this defect. The follow-up adds:

- A unit contract asserting that `resolveAppApiSurface(api).getAgentModelState` is the compact reader, not the full catalogue reader. It fails on the deployed source with `undefined`.
- A browser test that loads the actual built Classic and Visual entrypoints, HTML and static assets from a disposable localhost origin. API responses and EventSource are synthetic; requests cannot reach production.
- Cold load with cached context, forced reload, model/thinking SSE changes, context SSE changes, rejection of another chat's context, reconnect hydration and polling without an SSE event. The test uses the real EventSource-to-app dispatch path rather than directly invoking reducers.
- Chromium and WebKit at a 1024×768 tablet viewport. The final Classic regression fails against the unchanged deployed bundle at `38b013205` and passes after rebuilding the one-line correction. Both skins pass: 4 tests, 72 assertions.

The fixture disables service workers and stubs notification presence teardown to avoid WebKit navigation-time beacon failures unrelated to status rendering. Visual's setup check may read the full catalogue at boot; the test checks that reconnect hydration adds no catalogue request.

## Validation

- Focused units: 37 passes, 76 assertions across six files.
- Four typechecks pass. Changed-file lint, stale-dist, pack hygiene and diff checks pass.
- Full `make ci-fast`: 5,553 runtime passes, four skips, zero failures; 25 feature and nine build tests pass.
- Final post-build browser run: 22 passes, 236 assertions. This includes the four shipped-shell cases and the existing 18 reconciliation/polling cases.
- Repository-wide `bun run lint` reports 20 errors. Running it on unchanged main at `38b013205` produces identical diagnostics after sorting; none are in changed files.

The read-only delegated audit timed out; there is no independent-review result.

No production settings, installation or reload was changed during this follow-up.
