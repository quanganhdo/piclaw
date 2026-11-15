/** Explicit offline source-pin refresh. Never evaluates an add-on. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
const root = process.argv[2];
if (!root || !existsSync(join(root, "addons"))) throw Error("Pass the frozen candidate add-ons source root, not installed/live packages");
const output = join(import.meta.dir, "host-installed-addon-profiles.ts");
const text = readFileSync(output, "utf8");
const start = text.indexOf("export const installedAddonProfiles = ") + "export const installedAddonProfiles = ".length;
const end = text.lastIndexOf(" as const;");
const profiles = JSON.parse(text.slice(start, end));
for (const [slug, profile] of Object.entries(profiles) as [string, any][]) {
  const base = join(root, "addons", slug);
  const manifest = JSON.parse(readFileSync(join(base, "package.json"), "utf8"));
  if (manifest.name !== profile.name || typeof manifest.version !== "string" || !manifest.version)
    throw Error(`Invalid candidate package identity: ${slug}`);
  profile.version = manifest.version;
  const files: Record<string, string> = {};
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(base, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!["node_modules", "web", "vendor", ".git", ".artifacts", "tests", "skills", "assets"].includes(entry.name)) walk(file);
      } else if (/\.(ts|js|json)$/.test(file) && !/\.(test|spec)\.[tj]s$/.test(file)) {
        files[file] = createHash("sha256").update(readFileSync(join(base, file))).digest("hex");
      }
    }
  };
  walk("");
  profile.files = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const shadows = new Set<string>();
  for (const file of Object.keys(files).filter(file => file.endsWith(".ts"))) {
    for (const suffix of [".js", ".json", "/index.js", "/package.json"]) shadows.add(file.replace(/\.ts$/, suffix));
    let dir = dirname(file);
    while (dir !== ".") { shadows.add(`${dir}/package.json`); dir = dirname(dir); }
  }
  profile.shadows = [...shadows].filter(file => !(file in files)).sort();
}
writeFileSync(output, text.slice(0, start) + JSON.stringify(profiles, null, 2) + text.slice(end));
