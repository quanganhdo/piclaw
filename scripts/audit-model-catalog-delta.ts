#!/usr/bin/env bun
/**
 * Compare two @earendil-works/pi-ai provider catalog snapshots.
 *
 * Usage:
 *   bun run scripts/audit-model-catalog-delta.ts --base /tmp/pi-ai-old/dist/providers/data --head node_modules/@earendil-works/pi-ai/dist/providers/data
 *   bun run scripts/audit-model-catalog-delta.ts --base old --head new --json /tmp/catalog-delta.json --markdown /tmp/catalog-delta.md
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const DEFAULT_CATALOG = "node_modules/@earendil-works/pi-ai/dist/providers/data";
const STRUCTURAL_MODEL_FIELDS = [
  "api",
  "baseUrl",
  "reasoning",
  "thinkingLevelMap",
  "input",
  "contextWindow",
  "maxTokens",
  "compat",
] as const;
const COST_MODEL_FIELDS = ["cost"] as const;
const DISPLAY_MODEL_FIELDS = ["name"] as const;
const DEFAULT_MODEL_FIELDS = [...STRUCTURAL_MODEL_FIELDS, ...COST_MODEL_FIELDS, ...DISPLAY_MODEL_FIELDS] as const;

type FailOn = "none" | "providers" | "models" | "fields" | "any";

type Args = {
  base: string;
  head: string;
  json?: string;
  markdown?: string;
  providers?: Set<string>;
  fields: Set<string>;
  failOn: FailOn;
  includeUnchanged: boolean;
  help: boolean;
};

type CatalogModel = Record<string, unknown> & { id?: string; provider?: string };
type CatalogApi = Record<string, CatalogModel>;
type CatalogProvider = Record<string, CatalogApi>;
type Catalog = Record<string, CatalogProvider>;

type FieldChange = {
  field: string;
  before: unknown;
  after: unknown;
};

type ModelDelta = {
  provider: string;
  api: string;
  model: string;
  status: "added" | "removed" | "changed" | "unchanged";
  changes: FieldChange[];
};

type ApiMove = {
  provider: string;
  model: string;
  from_api: string;
  to_api: string;
};

type ProviderDelta = {
  provider: string;
  status: "added" | "removed" | "changed" | "unchanged";
  base_model_count: number;
  head_model_count: number;
  added_models: string[];
  removed_models: string[];
  changed_models: string[];
};

type CatalogDeltaReport = {
  generated_at: string;
  base: string;
  head: string;
  compared_fields: string[];
  provider_filter: string[] | null;
  summary: {
    providers_added: number;
    providers_removed: number;
    providers_changed: number;
    models_added: number;
    models_removed: number;
    models_changed: number;
    api_moves: number;
    base_entries: number;
    head_entries: number;
    field_changes: number;
    changed_entries_by_field: Record<string, number>;
  };
  provider_deltas: ProviderDelta[];
  model_deltas: ModelDelta[];
  api_moves: ApiMove[];
};

function usage(): string {
  return [
    "Compare two @earendil-works/pi-ai provider catalog snapshots.",
    "",
    "Options:",
    `  --base <dir>        Baseline provider data dir (default: ${DEFAULT_CATALOG})`,
    `  --head <dir>        Candidate provider data dir (default: ${DEFAULT_CATALOG})`,
    "  --providers <csv>   Limit comparison to provider ids",
    `  --fields <csv>      Model fields to compare (default: ${DEFAULT_MODEL_FIELDS.join(",")})`,
    "  --json <path>       Write full JSON report",
    "  --markdown <path>   Write Markdown summary",
    "  --include-unchanged Include unchanged model rows in JSON report",
    "  --fail-on <mode>    none|providers|models|fields|any (default: none)",
    "  --help             Show this help",
    "",
    "Notes:",
    "  The script reads local catalog JSON only; it does not fetch packages or use credentials.",
    "  Point --base/--head at pi-ai/dist/providers/data directories from two dependency versions.",
  ].join("\n");
}

function parseCsv(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    base: DEFAULT_CATALOG,
    head: DEFAULT_CATALOG,
    fields: new Set(DEFAULT_MODEL_FIELDS),
    failOn: "none",
    includeUnchanged: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    const needValue = () => {
      if (!next || next.startsWith("--")) throw new Error(`${arg} requires a value`);
      i += 1;
      return next;
    };

    switch (arg) {
      case "--base":
        args.base = needValue();
        break;
      case "--head":
        args.head = needValue();
        break;
      case "--json":
        args.json = needValue();
        break;
      case "--markdown":
      case "--md":
        args.markdown = needValue();
        break;
      case "--providers":
      case "--provider":
        args.providers = new Set(parseCsv(needValue()));
        break;
      case "--fields":
        args.fields = new Set(parseCsv(needValue()));
        break;
      case "--fail-on": {
        const mode = needValue() as FailOn;
        if (!["none", "providers", "models", "fields", "any"].includes(mode)) {
          throw new Error(`Invalid --fail-on mode: ${mode}`);
        }
        args.failOn = mode;
        break;
      }
      case "--include-unchanged":
        args.includeUnchanged = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.fields.size === 0) throw new Error("--fields must include at least one field");
  return args;
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function resolveCatalogDir(input: string): string {
  return resolve(process.cwd(), input);
}

function isProviderFile(name: string): boolean {
  return name.endsWith(".json") && !name.endsWith(".manifest.json") && !name.startsWith(".");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeProvider(payload: Record<string, unknown>, path: string): CatalogProvider {
  const values = Object.values(payload);

  // Catalogs are provider -> API -> model. Accept the former flat fixture shape too.
  if (values.every((value) => isRecord(value) && typeof value.id === "string")) {
    const result: CatalogProvider = {};
    for (const [model, value] of Object.entries(payload)) {
      const catalogModel = value as CatalogModel;
      const api = typeof catalogModel.api === "string" ? catalogModel.api : "<unknown>";
      (result[api] ??= {})[model] = catalogModel;
    }
    return result;
  }

  const result: CatalogProvider = {};
  for (const [api, models] of Object.entries(payload)) {
    if (!isRecord(models)) throw new Error(`Provider API catalog is not an object: ${path} (${api})`);
    for (const [model, value] of Object.entries(models)) {
      if (!isRecord(value)) throw new Error(`Model entry is not an object: ${path} (${api}/${model})`);
    }
    result[api] = models as CatalogApi;
  }
  return result;
}

async function readCatalog(inputDir: string, providerFilter?: Set<string>): Promise<Catalog> {
  const dir = resolveCatalogDir(inputDir);
  if (!existsSync(dir)) throw new Error(`Catalog directory does not exist: ${dir}`);

  const catalog: Catalog = {};
  const entries = (await readdir(dir)).filter(isProviderFile).sort((a, b) => a.localeCompare(b));
  for (const entry of entries) {
    const provider = entry.replace(/\.json$/, "");
    if (providerFilter && !providerFilter.has(provider)) continue;
    const payload = await readJsonFile(join(dir, entry));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(`Provider catalog is not an object: ${join(dir, entry)}`);
    }
    catalog[provider] = normalizeProvider(payload as Record<string, unknown>, join(dir, entry));
  }
  return catalog;
}

function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return `${typeof value}:${JSON.stringify(value)}`;
  if (Array.isArray(value)) return `array:[${value.map(stable).join(",")}]`;
  return `object:{${Object.keys(value as Record<string, unknown>)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function compareField(before: CatalogModel | undefined, after: CatalogModel | undefined, field: string): FieldChange | null {
  const beforeValue = before?.[field];
  const afterValue = after?.[field];
  if (stable(beforeValue) === stable(afterValue)) return null;
  return { field, before: beforeValue, after: afterValue };
}

function sortedKeys(record: Record<string, unknown> | undefined): string[] {
  return Object.keys(record ?? {}).sort((a, b) => a.localeCompare(b));
}

function providerEntries(provider: CatalogProvider | undefined): Array<{ api: string; model: string; value: CatalogModel }> {
  const entries: Array<{ api: string; model: string; value: CatalogModel }> = [];
  for (const api of sortedKeys(provider)) {
    for (const model of sortedKeys(provider?.[api])) entries.push({ api, model, value: provider![api][model] });
  }
  return entries;
}

function coordinate(api: string, model: string): string {
  return JSON.stringify([api, model]);
}

function displayCoordinate(api: string, model: string): string {
  return `${api}/${model}`;
}

function buildReport(args: Args, baseCatalog: Catalog, headCatalog: Catalog): CatalogDeltaReport {
  const fields = [...args.fields].sort((a, b) => a.localeCompare(b));
  const providers = [...new Set([...sortedKeys(baseCatalog), ...sortedKeys(headCatalog)])].sort((a, b) => a.localeCompare(b));
  const providerDeltas: ProviderDelta[] = [];
  const modelDeltas: ModelDelta[] = [];
  const apiMoves: ApiMove[] = [];

  for (const provider of providers) {
    const baseProvider = baseCatalog[provider];
    const headProvider = headCatalog[provider];
    const baseEntries = providerEntries(baseProvider);
    const headEntries = providerEntries(headProvider);
    const baseByCoordinate = new Map(baseEntries.map((entry) => [coordinate(entry.api, entry.model), entry]));
    const headByCoordinate = new Map(headEntries.map((entry) => [coordinate(entry.api, entry.model), entry]));
    const addedEntries = headEntries.filter((entry) => !baseByCoordinate.has(coordinate(entry.api, entry.model)));
    const removedEntries = baseEntries.filter((entry) => !headByCoordinate.has(coordinate(entry.api, entry.model)));
    const changedModels: string[] = [];

    const coordinates = [...new Set([...baseByCoordinate.keys(), ...headByCoordinate.keys()])].sort((a, b) => a.localeCompare(b));
    for (const key of coordinates) {
      const baseEntry = baseByCoordinate.get(key);
      const headEntry = headByCoordinate.get(key);
      const entry = baseEntry ?? headEntry!;
      const before = baseEntry?.value;
      const after = headEntry?.value;
      if (!before && after) {
        modelDeltas.push({ provider, api: entry.api, model: entry.model, status: "added", changes: [] });
        continue;
      }
      if (before && !after) {
        modelDeltas.push({ provider, api: entry.api, model: entry.model, status: "removed", changes: [] });
        continue;
      }
      const changes = fields.map((field) => compareField(before, after, field)).filter((change): change is FieldChange => Boolean(change));
      if (changes.length > 0) {
        changedModels.push(displayCoordinate(entry.api, entry.model));
        modelDeltas.push({ provider, api: entry.api, model: entry.model, status: "changed", changes });
      } else if (args.includeUnchanged) {
        modelDeltas.push({ provider, api: entry.api, model: entry.model, status: "unchanged", changes: [] });
      }
    }

    for (const model of [...new Set(removedEntries.map((entry) => entry.model))].sort()) {
      const from = removedEntries.filter((entry) => entry.model === model);
      const to = addedEntries.filter((entry) => entry.model === model);
      // Multiple removed/added routes cannot establish a unique move pairing.
      if (from.length === 1 && to.length === 1) {
        apiMoves.push({ provider, model, from_api: from[0].api, to_api: to[0].api });
      }
    }

    const addedModels = addedEntries.map((entry) => displayCoordinate(entry.api, entry.model));
    const removedModels = removedEntries.map((entry) => displayCoordinate(entry.api, entry.model));
    const status: ProviderDelta["status"] = !baseProvider
      ? "added"
      : !headProvider
        ? "removed"
        : (addedModels.length || removedModels.length || changedModels.length ? "changed" : "unchanged");
    providerDeltas.push({
      provider,
      status,
      base_model_count: baseEntries.length,
      head_model_count: headEntries.length,
      added_models: addedModels,
      removed_models: removedModels,
      changed_models: changedModels,
    });
  }

  const changedProviderDeltas = providerDeltas.filter((provider) => provider.status !== "unchanged");
  return {
    generated_at: new Date().toISOString(),
    base: resolveCatalogDir(args.base),
    head: resolveCatalogDir(args.head),
    compared_fields: fields,
    provider_filter: args.providers ? [...args.providers].sort((a, b) => a.localeCompare(b)) : null,
    summary: {
      providers_added: providerDeltas.filter((provider) => provider.status === "added").length,
      providers_removed: providerDeltas.filter((provider) => provider.status === "removed").length,
      providers_changed: changedProviderDeltas.filter((provider) => provider.status === "changed").length,
      models_added: modelDeltas.filter((model) => model.status === "added").length,
      models_removed: modelDeltas.filter((model) => model.status === "removed").length,
      models_changed: modelDeltas.filter((model) => model.status === "changed").length,
      api_moves: apiMoves.length,
      base_entries: providerDeltas.reduce((sum, provider) => sum + provider.base_model_count, 0),
      head_entries: providerDeltas.reduce((sum, provider) => sum + provider.head_model_count, 0),
      field_changes: modelDeltas.reduce((sum, model) => sum + model.changes.length, 0),
      changed_entries_by_field: Object.fromEntries(fields.map((field) => [field,
        modelDeltas.filter((model) => model.changes.some((change) => change.field === field)).length,
      ])),
    },
    provider_deltas: providerDeltas.filter((provider) => provider.status !== "unchanged" || args.includeUnchanged),
    model_deltas: modelDeltas,
    api_moves: apiMoves,
  };
}

function formatValue(value: unknown): string {
  if (value === undefined) return "`<unset>`";
  const text = typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
    ? String(value)
    : JSON.stringify(value);
  return `\`${text.replace(/`/g, "\\`")}\``;
}

function renderMarkdown(report: CatalogDeltaReport): string {
  const s = report.summary;
  const lines = [
    "# Model catalog delta audit",
    "",
    `Generated: ${report.generated_at}`,
    `Base: \`${report.base}\``,
    `Head: \`${report.head}\``,
    `Fields: ${report.compared_fields.map((field) => `\`${field}\``).join(", ")}`,
    report.provider_filter ? `Provider filter: ${report.provider_filter.map((field) => `\`${field}\``).join(", ")}` : null,
    "",
    "## Summary",
    "",
    "| Metric | Count |",
    "|---|---:|",
    `| Providers added | ${s.providers_added} |`,
    `| Providers removed | ${s.providers_removed} |`,
    `| Providers changed | ${s.providers_changed} |`,
    `| Baseline provider/API/model entries | ${s.base_entries} |`,
    `| Candidate provider/API/model entries | ${s.head_entries} |`,
    `| Entries added | ${s.models_added} |`,
    `| Entries removed | ${s.models_removed} |`,
    `| Entries changed | ${s.models_changed} |`,
    `| API moves | ${s.api_moves} |`,
    `| Field changes | ${s.field_changes} |`,
    "",
    "Counts identify provider/API/model entries, not unique model products or live availability.",
    "API moves remain in gross added/removed counts; ambiguous route pairings are not inferred.",
    "Field counts overlap when an entry changes more than one field.",
    "",
    "| Changed field | Entries |",
    "|---|---:|",
    ...Object.entries(s.changed_entries_by_field).filter(([, count]) => count > 0).map(([field, count]) => `| ${field} | ${count} |`),
    "",
    "## Provider deltas",
    "",
  ].filter((line): line is string => line !== null);

  if (report.provider_deltas.length === 0) {
    lines.push("No provider-level deltas.", "");
  } else {
    lines.push("| Provider | Status | Base models | Head models | Added | Removed | Changed |", "|---|---|---:|---:|---:|---:|---:|");
    for (const provider of report.provider_deltas) {
      lines.push(`| ${provider.provider} | ${provider.status} | ${provider.base_model_count} | ${provider.head_model_count} | ${provider.added_models.length} | ${provider.removed_models.length} | ${provider.changed_models.length} |`);
    }
    lines.push("");
  }

  const changedModels = report.model_deltas.filter((model) => model.status !== "unchanged");
  lines.push("## Model deltas", "");
  if (changedModels.length === 0) {
    lines.push("No model-level deltas.", "");
    return lines.join("\n");
  }

  for (const model of changedModels) {
    lines.push(`### ${model.provider}/${model.model} — ${model.status} (API: ${model.api})`);
    if (model.changes.length === 0) {
      lines.push("", model.status === "added" ? "Model added." : "Model removed.", "");
      continue;
    }
    lines.push("", "| Field | Before | After |", "|---|---|---|");
    for (const change of model.changes) {
      lines.push(`| ${change.field} | ${formatValue(change.before)} | ${formatValue(change.after)} |`);
    }
    lines.push("");
  }
  if (report.api_moves.length > 0) {
    lines.push("## API moves", "", "| Provider | Model | From API | To API |", "|---|---|---|---|");
    for (const move of report.api_moves) lines.push(`| ${move.provider} | ${move.model} | ${move.from_api} | ${move.to_api} |`);
    lines.push("");
  }
  return lines.join("\n");
}

function shouldFail(report: CatalogDeltaReport, mode: FailOn): boolean {
  if (mode === "none") return false;
  const s = report.summary;
  if (mode === "any") return s.providers_added + s.providers_removed + s.providers_changed + s.models_added + s.models_removed + s.models_changed + s.api_moves + s.field_changes > 0;
  if (mode === "providers") return s.providers_added + s.providers_removed + s.providers_changed > 0;
  if (mode === "models") return s.models_added + s.models_removed + s.models_changed > 0;
  if (mode === "fields") return s.field_changes > 0;
  return false;
}

async function writeOutput(path: string, content: string): Promise<void> {
  await mkdir(dirname(resolve(process.cwd(), path)), { recursive: true });
  await writeFile(path, content);
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const [baseCatalog, headCatalog] = await Promise.all([
    readCatalog(args.base, args.providers),
    readCatalog(args.head, args.providers),
  ]);
  const report = buildReport(args, baseCatalog, headCatalog);
  const markdown = renderMarkdown(report);

  if (args.json) await writeOutput(args.json, JSON.stringify(report, null, 2) + "\n");
  if (args.markdown) await writeOutput(args.markdown, markdown + "\n");

  if (!args.json && !args.markdown) {
    console.log(markdown);
  } else {
    const s = report.summary;
    console.log(`Catalog delta: providers +${s.providers_added}/-${s.providers_removed}/${s.providers_changed} changed, models +${s.models_added}/-${s.models_removed}/${s.models_changed} changed, API moves ${s.api_moves}, fields ${s.field_changes}`);
  }

  if (shouldFail(report, args.failOn)) {
    console.error(`Catalog delta exceeded --fail-on=${args.failOn}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
