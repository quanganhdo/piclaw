# Emergency hotfix releases

An explicit maintainer instruction to ship a hotfix or retag through this path authorises it. Do not ask for a second confirmation. Normal patch releases retain their integration, UX and smoke gates.

Use the manual **Emergency release artifacts** workflow (`hotfix.yml`) with an existing release tag and a full 40-character source commit SHA. The package version must match the tag. The workflow builds Docker digests, a tagged multi-architecture image, five portable packages and source archives without executing test suites, UX, integration or image smoke checks. Build, dependency installation and archive creation failures still stop publication. It leaves Docker `latest` unchanged.

```sh
gh workflow run hotfix.yml -R rcarmo/piclaw --ref main -f tag=v3.3.2 -f sha=<full-source-sha>
```

Merge the requested fix first. Push the workflow/source commit before dispatching; `workflow_dispatch` requires the workflow on the default branch. For an explicitly authorised no-test hotfix push, `PICLAW_SKIP_PRE_PUSH_CI=1 git push origin main` avoids the normal local pre-push suite. This opt-out is only for this emergency operation.

Do not push a release tag with git: that starts the normal gated publish workflow. The emergency workflow force-updates the existing tag through its repository `GITHUB_TOKEN` after successful artifact builds, which does not trigger another workflow. It adds an explicit untested warning, exact SHA, actor and run link to the existing release notes. Preserve previous notes and add the hotfix description. Remove obsolete UX report assets: they describe the old commit and must not imply qualification of the new one.

Check the workflow succeeds, verify the remote tag SHA and published assets, and report any failed build plainly. A failed workflow may have pushed digest images or uploaded some assets; never claim an atomic release. No implicit install, restart or fleet rollout approval accompanies artifact publication.

The workflow definition itself should be checked when changing it. That development validation does not reintroduce test suites into emergency artifact runs. Record any historical PR qualification separately; it is not evidence that the combined hotfix commit passed release gates.
