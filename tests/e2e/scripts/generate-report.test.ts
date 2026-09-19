import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const script = resolve(import.meta.dir, "generate-report.ts");
const fixtureImage = resolve(import.meta.dir, "../../../docs/reviews/vnc-narrow-pane/manager-360.png");

function reportFixture(withEvidence: boolean): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "piclaw-e2e-report-"));
  mkdirSync(join(root, "reports", "evidence"), { recursive: true });
  writeFileSync(join(root, "reports", "results.json"), JSON.stringify({ config: { projects: [{ name: "desktop-chrome" }] }, suites: [] }));
  if (withEvidence) {
    cpSync(fixtureImage, join(root, "reports", "evidence", "classic-timeline.png"));
    cpSync(fixtureImage, join(root, "reports", "evidence", "classic-settings.png"));
    cpSync(fixtureImage, join(root, "reports", "evidence", "visual-timeline.png"));
    cpSync(fixtureImage, join(root, "reports", "evidence", "visual-settings.png"));
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("release report embeds representative visual evidence when the capture is present", () => {
  const fixture = reportFixture(true);
  try {
    const result = Bun.spawnSync([process.execPath, script], { cwd: fixture.root, env: process.env });
    expect(result.exitCode).toBe(0);
    const html = readFileSync(join(fixture.root, "reports", "piclaw-e2e-report.html"), "utf8");
    expect(html).toContain("Representative layout evidence");
    expect(html).toContain("Classic timeline and compose");
    expect(html).toContain("Visual Workspace Settings");
    expect(html).not.toContain("Representative layout capture was unavailable");
  } finally {
    fixture.cleanup();
  }
});

test("release report remains explicit when visual capture is unavailable", () => {
  const fixture = reportFixture(false);
  try {
    const result = Bun.spawnSync([process.execPath, script], { cwd: fixture.root, env: process.env });
    expect(result.exitCode).toBe(0);
    const html = readFileSync(join(fixture.root, "reports", "piclaw-e2e-report.html"), "utf8");
    expect(html).toContain("Representative layout capture was unavailable for this shard.");
  } finally {
    fixture.cleanup();
  }
});
