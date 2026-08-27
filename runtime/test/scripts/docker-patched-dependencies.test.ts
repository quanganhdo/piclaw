import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");
const dockerignore = readFileSync(resolve(repoRoot, ".dockerignore"), "utf8");
const buildScript = readFileSync(resolve(repoRoot, "scripts/docker/build-piclaw-package.sh"), "utf8");

test("Docker image staging preserves Bun patched dependencies through global install", () => {
  expect(dockerfile).toContain("COPY --chown=agent:agent patches/ /home/agent/piclaw/patches/");
  expect(dockerfile).toContain("COPY --chown=agent:agent scripts/prepare-local-install.ts /home/agent/piclaw/scripts/prepare-local-install.ts");
  expect(dockerignore).toContain("!patches/**");
  expect(dockerignore).toContain("!scripts/prepare-local-install.ts");

  expect(buildScript).toContain("bun run scripts/prepare-local-install.ts");
  expect(buildScript).toContain('sudo cp -R "$PATCH_STAGE"/. "$GLOBAL_DIR"/');
  expect(buildScript).toContain('sudo cp "$GLOBAL_PACKAGE" "$GLOBAL_PKG"');
  expect(buildScript).toContain('install -g "$INSTALL_TARBALL"');
  expect(buildScript).not.toContain('install -g "$TARBALL"');
});
