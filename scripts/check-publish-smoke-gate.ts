/** Required image checks precede manifest and complete-release publication. */
export function checkPublishSmokeGate(workflow: Record<string, any>): void {
  function require(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
  }

  for (const arch of ["amd64", "arm64"]) {
    const job = workflow.jobs?.[`build-${arch}`];
    require(job && job["continue-on-error"] === undefined, `${arch} image job must be required.`);
    const smoke = job.steps?.filter((step: Record<string, any>) =>
      step.name === `Smoke test ${arch.toUpperCase()} image`);
    require(smoke?.length === 1, `${arch} must have exactly one image smoke step.`);
    const step = smoke[0];
    require(step["continue-on-error"] === undefined && step.if === undefined,
      `${arch} image smoke must propagate failures without conditional bypasses.`);
    require(step["timeout-minutes"] === 5 && step.env?.STATIC_TIMEOUT_SEC === "120" &&
      step.env?.HTTP_TIMEOUT_SEC === "180", `${arch} smoke time limits must remain unchanged.`);
    require(step.run?.replace(/\\\n\s*/g, "").trim() === 'make publish-smoke IMAGE_REF="${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}" ' +
      `PLATFORM="linux/${arch}" ` +
      'EXPECTED_BUN_VERSION="${{ needs.resolve-runtime-versions.outputs.bun_version }}" ' +
      'EXPECTED_RESTIC_VERSION="${{ needs.resolve-runtime-versions.outputs.restic_version }}"',
      `${arch} smoke must use the built digest and pinned runtime versions.`);
  }

  const merge = workflow.jobs?.merge;
  require(JSON.stringify(merge?.needs) === JSON.stringify(["build-amd64", "build-arm64"]) &&
    merge.if === undefined && merge["continue-on-error"] === undefined,
    "Manifest publication must require both image jobs to succeed.");
  const assets = workflow.jobs?.["publish-portable-assets"];
  require(assets?.needs?.includes("merge") && assets.needs.includes("build-portable-artifacts") &&
    assets.if?.replace(/\s/g, "") === "${{always()&&needs.merge.result=='success'&&needs.resolve-runtime-versions.result=='success'&&needs.build-portable-artifacts.result=='success'&&(needs.build-experimental-shell-artifacts.result=='success'||needs.build-experimental-shell-artifacts.result=='skipped')}}" &&
    assets["continue-on-error"] === undefined,
    "Complete-release assets must require successful images and portable builds.");
}
