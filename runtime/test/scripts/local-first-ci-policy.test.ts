import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
const development = readFileSync(join(repoRoot, "docs/development.md"), "utf8");
const normalize = (value: string) => value.replace(/[*`]/g, "").replace(/\s+/g, " ").toLowerCase();

test("repository policy requires local completion before hosted PR validation", () => {
  for (const policy of [agents, development]) {
    const text = normalize(policy);
    expect(text).toContain("make ci-fast");
    expect(text).toMatch(/locally complete|local validation is complete/);
    expect(text).toContain("existing automatic pr check");
    expect(text).toContain("supplementary hosted evidence");
    expect(text).toMatch(/hosted ci|github actions/);
    expect(text).toContain("iterative");
    expect(text).toMatch(/not .*development loop|not .*iterative|do not .*iterative/);
  }
});

test("repository-owned locally validated PRs merge without waiting for hosted CI", () => {
  for (const policy of [agents, development]) {
    const text = normalize(policy);
    expect(text).toMatch(/repository-owned prs?/);
    expect(text).toMatch(/explicit .*merge authorization|explicit merge authorization/);
    expect(text).toMatch(/passing .*local gates|passing required local gates/);
    expect(text).toContain("merge without waiting for hosted ci");
    expect(text).toMatch(/external\/untrusted|external or untrusted/);
    expect(text).toContain("platform-specific");
    expect(text).toMatch(/checks may finish after an authorized merge/);
  }
});

test("repository policy forbids temporary workflows and ad-hoc Actions dispatch for feature iteration", () => {
  expect(agents).toContain("Do **not** add temporary or per-feature GitHub Actions workflows");
  expect(agents).toContain("Do **not** dispatch GitHub Actions manually");
  expect(development).toContain("Do not add temporary/per-feature workflows");
  expect(development).toContain("manually dispatch Actions");

  for (const policy of [agents, development]) {
    const text = normalize(policy);
    expect(text).toContain("explicitly authorized");
    expect(text).toContain("documented");
    expect(text).toContain("release");
    expect(text).toMatch(/operational|operations/);
    expect(text).not.toMatch(/workflow_dispatch.*ad-hoc ux test runs/);
  }
});
