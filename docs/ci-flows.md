# CI workflows and dependencies

This page maps the GitHub Actions CI and release flow defined in `.github/workflows/`.

```mermaid
flowchart TB
  %% Triggers
  P_MAIN["push: main"] --> CI
  PR_ANY["pull_request"] --> CI
  TAG_REL["push tag: * except *-ux, *-prerelease"] --> IG
  TAG_REL --> PUB
  TAG_UX["push tag: *-ux or *-prerelease"] --> E2E
  MANUAL["workflow_dispatch"] --> E2E
  WORKITEMS_EVT["push/pull_request on workitems/**"] --> WLOCK

  %% CI
  subgraph CI["CI (ci.yml)"]
    direction TB
    CI1["web-build: Checkout"] --> CI2["Setup Bun"] --> CI3["Install dependencies"] --> CI4["Run canonical fast CI contract (make ci-fast)"]
  end

  %% E2E
  subgraph E2E["E2E Tests (e2e.yml)"]
    direction TB
    E1["Checkout"] --> E2["Setup Bun"] --> E3["Install dependencies"] --> E4["Install E2E deps"] --> E5["Install Playwright browsers"] --> E6["Configure LLM provider"] --> E7["Start PiClaw instance"] --> E8["Validate test environment"] --> E9["Run E2E tests (matrix stage)"] --> E10["Generate PDF report"] --> E11["Upload test report"] --> E12["Upload test results"] --> E13["Stop server"]
    EStage["Matrix stages:\nsmoke-and-shell\ncompose-queue\nmessage-deletion\ncompose-visibility\ntheme-tint\nsessions-and-settings\nworkspace-editor\nterminal-panes\nscreenshots-and-resilience\ncompaction-model"] -.-> E9
  end

  %% Integration gate
  subgraph IG["Integration gate (integration-gate.yml)"]
    direction TB
    IG1["Checkout"] --> IG2["Setup Bun"] --> IG3["Install dependencies"] --> IG4["Install Playwright browsers"] --> IG5["Install Playwright system deps"] --> IG6["Run full integration suite (make ci-integration)"]
  end

  %% Publish
  subgraph PUB["Publish Docker images (publish.yml)"]
    direction TB

    PWAIT["wait-for-integration: Wait for Integration gate workflow run"]
    PRES["resolve-runtime-versions: Checkout + read BUN_VERSION + read RESTIC_VERSION"]

    PPORT["build-portable-artifacts (matrix linux-x64/linux-x64-baseline/linux-arm64/macos-arm64/windows-x64): Checkout → Setup Bun → Install deps → Build portable → Upload artifact"]


    PAMD["build-amd64: Checkout → Buildx → GHCR login → Metadata → Build/push AMD64 → Smoke test"]

    PARM["build-arm64: Checkout → Buildx → GHCR login → Metadata → Build/push ARM64 → Smoke test"]

    PMERGE["merge: Buildx → GHCR login → Metadata → Create/push multi-arch manifest → Inspect merged image"]

    PPUBAS["publish-portable-assets: Checkout → Download portable artifacts → Download desktop artifacts → Create release/upload assets"]

    PPRUNE["prune-releases: Prune old releases/tags"]
    PCLEAN["cleanup-actions-history: Delete old Actions runs/artifacts"]
    PPRUNEDOCK["prune-docker-images: Delete untagged images"]

    PWAIT --> PPORT
    PWAIT --> PAMD
    PWAIT --> PARM
    PRES --> PAMD
    PRES --> PARM
    PAMD --> PMERGE
    PARM --> PMERGE
    PMERGE --> PPUBAS
    PPORT --> PPUBAS
    PPUBAS --> PPRUNE
    PPUBAS --> PCLEAN
    PMERGE --> PPRUNEDOCK
  end

  %% Cross-workflow gate (implemented by polling in publish.yml)
  IG6 -. "must complete successfully" .-> PWAIT

  %% Workitems lock
  subgraph WLOCK["Workitems archive lock (workitems-lock.yml)"]
    direction TB
    W1["checkout@v6 (fetch-depth:2)"] --> W2["Reject new workitems/*.md outside _archive/_templates"]
  end
```

## Workflow files

- `.github/workflows/ci.yml`
- `.github/workflows/e2e.yml`
- `.github/workflows/integration-gate.yml`
- `.github/workflows/publish.yml`
- `.github/workflows/workitems-lock.yml`
