import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions } from "esbuild";

import { ensureEsbuildExecutable } from "../../../../scripts/repo-dev-command.js";

const watchMode = process.argv.includes("--watch");
const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(frontendDir, "../../../../..");
const outputDir = path.resolve(frontendDir, "../dist");

ensureEsbuildExecutable(packageDir);
const { build, context } = await import("esbuild");

const options: BuildOptions = {
  entryPoints: [path.join(frontendDir, "src/index.tsx")],
  outfile: path.join(outputDir, "app.bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  minify: true,
  jsx: "automatic",
  jsxImportSource: "preact",
};

await mkdir(outputDir, { recursive: true });

if (watchMode) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("[frontend] watching for changes...");
} else {
  await build(options);
  console.log("[frontend] built runtime/web/static/visual/dist/app.bundle.js");
}
