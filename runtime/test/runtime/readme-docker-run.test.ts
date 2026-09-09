import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

test("README quick start uses docker --init for cleaner container shutdown", () => {
  const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
  const guide = readFileSync(resolve(ROOT, "docs/getting-started.md"), "utf8");
  const compose = readFileSync(resolve(ROOT, "docker-compose.yml"), "utf8");

  expect(readme).toContain("docker run -d \\\n  --init \\");
  expect(readme).toContain("docs/getting-started.md");
  expect(guide).toContain("`init: true`, equivalent to `docker run --init`");
  expect(compose).toMatch(/^\s+init: true$/m);
});
