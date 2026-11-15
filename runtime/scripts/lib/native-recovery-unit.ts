import Database from "bun:sqlite";
import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { createVerifiedSqliteBackup, verifySqliteBackup, type SqliteBackupManifest } from "../../src/db/backup.js";
import { verifyBackgroundRecoveryPayload } from '../../durable-engine/src/host-background-context.js';
import { collectNativeRecoveryReferences, type NativeRecoveryReference } from "./native-recovery-references.js";
import { assertSchemaInventory, readSchemaInventory, type SchemaContract } from "./schema-ownership.js";
import { inspectRecoverySubmissions } from "../../durable-engine/src/recovery-submission-inspection.js";
import { auditInstalledApplicationAddonSources, applicationAddonSourceProfiles } from "../../durable-engine/src/host-extension-catalog.js";

const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const isHash = (value: unknown): value is string => typeof value === "string" && value.length === 64 && !/[^a-f0-9]/.test(value);
const compare = (a: string,b: string) => a < b ? -1 : a > b ? 1 : 0;
export interface RecoveryEnvironment {
  /** Operator-associated source contract; never inferred from an unversioned filename. */
  runtime: { coreRevision: string; sdkVersion: string; bunVersion: string };
  addonWorkspace: string;
  /** Matching external private configuration remains part of the recovery unit. Values are never written into its manifest. */
  configurations: readonly { id: string; path: string }[];
  credentialReferences: readonly string[];
  /** Metadata-only availability probe. Must not retrieve secrets or authenticate providers. */
  credentialReferenceAvailable(ref: string): boolean;
}
export interface RecoveryCaptureOptions {
  database: string;
  answers: string;
  workspace: string;
  output: string;
  environment: RecoveryEnvironment;
  /** Adapter-owned outbox payloads have no universal on-disk path. Exact immutable proofs are mandatory. */
  externalPayloads?: readonly { ref: string; path: string; sha256: string; byteLength: number; mediaType: string; redactionClass: NativeRecoveryReference["redactionClass"] }[];
}
interface StoredFile { file: string; sha256: string; byteLength: number }
type StoredReference = Omit<NativeRecoveryReference, "ref" | "sha256" | "byteLength" | "mediaType"> & StoredFile & { referenceSha256: string; mediaType: string };
export interface NativeRecoveryUnitManifest {
  version: 1;
  kind: "piclaw.native-recovery-unit";
  database: StoredFile & { verification: ReturnType<typeof verifySqliteBackup> };
  schemaSha256: string;
  bindingsSha256: string;
  environment: ReturnType<typeof environmentProof>;
  references: readonly StoredReference[];
  /** Preserve even unreferenced immutable answer files; capture does not perform retention. */
  answerFiles: readonly StoredFile[];
}
function identifier(value: string) {
  if (typeof value !== "string" || !value || value.length > 512 || /[^A-Za-z0-9_.:/@+-]/.test(value)) throw Error("Invalid recovery dependency identity");
  return value;
}
function offline(path: string): string {
  const absolute = resolve(path);
  const active = [process.env.PICLAW_STORE, process.env.PICLAW_DATA, process.env.PI_CODING_AGENT_DIR].filter((path): path is string => !!path).map(path => resolve(path));
  if (absolute === "/workspace" || absolute === resolve(process.env.PICLAW_WORKSPACE ?? "/workspace") ||
    active.some(root => absolute === root || absolute.startsWith(root + sep)) || absolute.split(sep).some(part => part === ".pi" || part === ".piclaw"))
    throw Error("Explicit offline copies outside runtime profiles are required");
  return absolute;
}
export { offline as assertOfflineRecoveryPath };
function directory(path: string, privateOutput = false): string {
  const absolute = resolve(path), info = lstatSync(absolute);
  if (!info.isDirectory() || realpathSync(absolute) !== absolute || privateOutput && ((info.mode & 0o077) !== 0 || process.getuid && info.uid !== process.getuid()))
    throw Error("Invalid recovery directory binding");
  return absolute;
}
function boundFile<T>(path: string, read: (fd: number) => { value: T; byteLength: number }): T {
  const absolute = resolve(path);
  if (realpathSync(absolute) !== absolute) throw Error("Recovery file symlink refused");
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1) throw Error("Exclusive regular recovery file required");
    const result = read(fd), after = fstatSync(fd), named = lstatSync(absolute);
    if (before.dev !== named.dev || before.ino !== named.ino || after.size !== before.size || result.byteLength !== before.size || after.mtimeMs !== before.mtimeMs)
      throw Error("Recovery file changed while reading");
    return result.value;
  } finally { closeSync(fd); }
}
function bytes(path: string): Uint8Array {
  return boundFile(path, fd => { const value = new Uint8Array(readFileSync(fd)); return { value, byteLength: value.length }; });
}
function fingerprint(path: string): Omit<StoredFile, "file"> {
  return boundFile(path, fd => {
    const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024); let byteLength = 0, length: number;
    while ((length = readSync(fd, buffer, 0, buffer.length, null)) > 0) { hash.update(buffer.subarray(0,length)); byteLength += length; }
    return { value: { sha256: hash.digest("hex"), byteLength }, byteLength };
  });
}
export { fingerprint as fingerprintRecoveryFile };
export function fingerprintSqliteTables(db: Database, tables: readonly string[]): string {
  const hash = createHash("sha256"), quote = (name: string) => '"' + name.replaceAll('"','""') + '"';
  for (const table of tables) {
    hash.update(JSON.stringify(table) + "\n");
    const columns = db.query(`PRAGMA table_info(${quote(table)})`).all() as { name: string; pk: number | bigint }[];
    const primary = columns.filter(column => Number(column.pk) > 0).sort((a,b) => Number(a.pk)-Number(b.pk));
    const order = primary.length ? primary.map(column => quote(column.name)).join(",") : "rowid";
    for (const row of db.query<Record<string,unknown>,[]>(`SELECT * FROM ${quote(table)} ORDER BY ${order}`).iterate())
      hash.update(JSON.stringify(Object.values(row), (_key,value) => typeof value === "bigint" ? {integer:String(value)} : value instanceof Uint8Array ? {blob:Buffer.from(value).toString("hex")} : value) + "\n");
  }
  return hash.digest("hex");
}
function sync(path: string) {
  const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
}
function publish(path: string, data: string | Uint8Array) {
  writeFileSync(path, data, { flag: "wx", mode: 0o600 }); sync(path);
}
function exactFields(value: object, fields: readonly string[]) {
  if (!value || typeof value !== "object" || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) throw Error("Unsupported recovery manifest fields");
}
function environmentProof(env: RecoveryEnvironment) {
  if (env.runtime.coreRevision.length !== 40 || /[^a-f0-9]/.test(env.runtime.coreRevision) || env.runtime.sdkVersion !== "1.4.0" ||
    !/^\d+\.\d+\.\d+$/.test(env.runtime.bunVersion) || /[^0-9.]/.test(env.runtime.bunVersion))
    throw Error("Unsupported recovery runtime contract");
  const credentials = [...env.credentialReferences].map(identifier).sort();
  if (new Set(credentials).size !== credentials.length || credentials.some(ref => env.credentialReferenceAvailable(ref) !== true))
    throw Error("Required credential reference unavailable");
  const configs = env.configurations.map(({ id, path }) => ({ id: identifier(id), ...fingerprint(offline(path)) })).sort((a,b) => compare(a.id,b.id));
  if (!configs.length || new Set(configs.map(c => c.id)).size !== configs.length) throw Error("Exact configuration dependencies required");
  const addons = auditInstalledApplicationAddonSources(directory(offline(env.addonWorkspace))).profiles.map(profile => {
    const source = applicationAddonSourceProfiles[profile.kind];
    return { name: profile.name, version: profile.version, filesSha256: sha(JSON.stringify(source.files)), packageSha256: fingerprint(join(profile.packageDir, "package.json")).sha256 };
  }).sort((a,b) => compare(a.name,b.name));
  return { runtime: { coreRevision: env.runtime.coreRevision, sdkVersion: env.runtime.sdkVersion, bunVersion: env.runtime.bunVersion }, configurations: configs, credentialReferences: credentials, addons };
}
function databaseProof(db: Database) {
  const contract = JSON.parse(readFileSync(new URL("../schema-ownership.json", import.meta.url), "utf8")) as SchemaContract;
  assertSchemaInventory(readSchemaInventory(db), contract, "native");
  if (db.query("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='addon_code_review_schema'").get()) {
    const rows = db.query("SELECT id,version FROM addon_code_review_schema").all() as { id: number | bigint; version: number | bigint }[];
    if (rows.length !== 1 || Number(rows[0]!.id) !== 1 || Number(rows[0]!.version) !== 1) throw Error("Unsupported retained Code Review schema version");
  }
  const encode = (value: unknown) => JSON.stringify(value, (_key, value) => typeof value === "bigint" ? { integer: String(value) } : value instanceof Uint8Array ? { blob: Buffer.from(value).toString("hex") } : value);
  const schema = db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").values();
  const bindings = ["piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1"];
  for (const name of bindings) if (!db.query("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name)) throw Error("Native recovery bindings required");
  for (const name of ["durable_schema", "durable_metadata", "conversations", "entries", "tasks", "submissions", "documents", "document_revisions", "record_ids"])
    if (!db.query("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name)) throw Error("Native recovery schema required");
  if (db.query("PRAGMA foreign_key_check").get()) throw Error("Recovery database foreign-key failure");
  return { schemaSha256: sha(encode(schema)), bindingsSha256: fingerprintSqliteTables(db,bindings) };
}
function readonly(path: string) {
  const db = new Database(path, { readonly: true, strict: true, safeIntegers: true }); db.exec("PRAGMA query_only=ON"); return db;
}
async function snapshotReferences(path: string, db: Database) {
  if (!db.query("SELECT 1 FROM piclaw_durable_intent_bindings_v1 LIMIT 1").get()) return collectNativeRecoveryReferences(db);
  const rows=db.query(`SELECT submission_id FROM piclaw_durable_bindings_v1 WHERE submission_id IS NOT NULL
    UNION SELECT submission_id FROM piclaw_durable_intent_bindings_v1 WHERE submission_id IS NOT NULL`).all() as {submission_id:number|bigint}[];
  return collectNativeRecoveryReferences(db,await inspectRecoverySubmissions(path,rows.map(row=>Number(row.submission_id))));
}
/** Capture only explicitly selected OFFLINE copies. No source discovery, promotion,
 * overwrite, retry, restore activation, provider call or credential retrieval.
 * Failure preserves incomplete artefacts; only a fully published manifest is a unit.
 */
export async function captureNativeRecoveryUnit(options: RecoveryCaptureOptions): Promise<NativeRecoveryUnitManifest> {
  const source = offline(options.database), output = offline(options.output);
  const sourceHash = fingerprint(source).sha256;
  for (const suffix of ["-wal","-shm","-journal"]) {
    const path=source+suffix;
    try { lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    fingerprint(path); // Sidecars may contain committed input; never follow an alias into another store.
  }
  const answersPath = offline(options.answers), answers = existsSync(answersPath) ? directory(answersPath) : undefined;
  const workspace = directory(offline(options.workspace));
  const environment = environmentProof(options.environment);
  directory(dirname(output), true);
  for (const input of [answersPath, workspace, resolve(options.environment.addonWorkspace)])
    if (output === input || output.startsWith(input + sep)) throw Error("Recovery output must not modify an input tree");
  mkdirSync(output, { mode: 0o700 }); directory(output, true);
  mkdirSync(join(output, "payloads"), { mode: 0o700 }); mkdirSync(join(output, "artifacts"), { mode: 0o700 });
  const sourceDb = new Database(source, { readonly: true, strict: true, safeIntegers: true });
  let verification: SqliteBackupManifest;
  try {
    if (fingerprint(source).sha256 !== sourceHash) throw Error("Offline source changed before snapshot");
    verification = createVerifiedSqliteBackup(sourceDb, source, join(output, "database.sqlite"));
    if (fingerprint(source).sha256 !== sourceHash) throw Error("Offline source changed during snapshot");
  } finally { sourceDb.close(); }
  const db = readonly(join(output, "database.sqlite"));
  try {
    const proof = databaseProof(db), references = await snapshotReferences(join(output,"database.sqlite"),db);
    const files = new Map<string, StoredFile>();
    const store = (file: string, data: Uint8Array): StoredFile => {
      const value = { file, sha256: sha(data), byteLength: data.length }, old = files.get(file);
      if (old) { if (JSON.stringify(old) !== JSON.stringify(value)) throw Error("Recovery payload collision"); return old; }
      publish(join(output, file), data); files.set(file, value); return value;
    };
    const answerFiles = (answers ? readdirSync(answers).sort() : []).map(name => {
      if (!isHash(name)) throw Error("Unknown answer-store object; preserve source");
      const data = bytes(join(answers!, name));
      new TextDecoder("utf-8", { fatal: true }).decode(data);
      return store(`payloads/${name}`, data);
    });
    const external = new Map((options.externalPayloads ?? []).map(value => [value.ref, value]));
    if (external.size !== (options.externalPayloads?.length ?? 0)) throw Error("Duplicate external payload proof");
    const stored = references.map(reference => {
      let file: StoredFile, mediaType=reference.mediaType;
      if (reference.location === "answers") {
        const found = files.get(`payloads/${sha(reference.ref)}`);
        if (!found) throw Error("Required native payload missing");
        file = found;
        if(reference.owner==='native-background-input')verifyBackgroundRecoveryPayload(db,reference.ref,new TextDecoder('utf-8',{fatal:true}).decode(bytes(join(output,file.file))));
      } else if (reference.location === "workspace") file = store(`artifacts/${sha(reference.ref)}`, bytes(join(workspace, reference.ref)));
      else {
        const declared = external.get(reference.ref);
        if (!declared || !isHash(declared.sha256) || !Number.isSafeInteger(declared.byteLength) || declared.byteLength < 0 ||
          typeof declared.mediaType !== "string" || !declared.mediaType || declared.mediaType.length > 2048 || /[\r\n\0]/.test(declared.mediaType) ||
          declared.redactionClass !== reference.redactionClass) throw Error("Adapter-owned payload proof required");
        mediaType=declared.mediaType;
        file = store(`artifacts/${sha(reference.ref)}`, bytes(offline(declared.path)));
        if (file.sha256 !== declared.sha256 || file.byteLength !== declared.byteLength) throw Error("Adapter-owned payload corrupt");
      }
      if (reference.sha256 !== undefined && (reference.sha256 !== file.sha256 || reference.byteLength !== file.byteLength)) throw Error("Referenced payload corrupt");
      const { ref, sha256: _expectedSha, byteLength: _expectedLength, ...binding } = reference;
      if (!mediaType) throw Error("Recovery payload media type required");
      return { ...binding, mediaType, referenceSha256: sha(ref), ...file };
    });
    if (JSON.stringify(environmentProof(options.environment)) !== JSON.stringify(environment)) throw Error("Recovery dependencies changed during capture");
    const { sourcePath: _source, destinationPath: _destination, createdAt: _at, sourceBytes: _bytes, ...checked } = verification;
    const manifest: NativeRecoveryUnitManifest = { version: 1, kind: "piclaw.native-recovery-unit", database: { file: "database.sqlite", ...fingerprint(join(output,"database.sqlite")), verification: checked },
      ...proof, environment, references: stored, answerFiles };
    sync(join(output,"payloads")); sync(join(output,"artifacts"));
    publish(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    sync(output); sync(dirname(output));
    return manifest;
  } finally { db.close(); }
}

export function nativeRecoveryManifestSha256(path: string): string {
  const unit = directory(offline(path), true);
  return sha(bytes(join(unit,"manifest.json")));
}

/** Verify bytes and required external metadata. Never opens a provider, resumes
 * SDK scheduling, rewrites the unit or resolves a credential's secret value. */
export async function verifyNativeRecoveryUnit(path: string, environment: RecoveryEnvironment, expectedManifestSha256?: string): Promise<NativeRecoveryUnitManifest> {
  const unit = directory(offline(path), true);
  const expectedNames = ["artifacts","database.sqlite","manifest.json","payloads"];
  if (JSON.stringify(readdirSync(unit).sort()) !== JSON.stringify(expectedNames)) throw Error("Unexpected recovery artefact or SQLite sidecar");
  directory(join(unit,"payloads"), true); directory(join(unit,"artifacts"), true);
  const manifestBytes = bytes(join(unit,"manifest.json")), manifestSha256 = sha(manifestBytes);
  if (expectedManifestSha256 !== undefined && (!isHash(expectedManifestSha256) || expectedManifestSha256 !== manifestSha256)) throw Error("Recovery manifest approval mismatch");
  let manifest: NativeRecoveryUnitManifest;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)); }
  catch { throw Error("Invalid recovery manifest encoding"); }
  exactFields(manifest,["version","kind","database","schemaSha256","bindingsSha256","environment","references","answerFiles"]);
  if (manifest?.version !== 1 || manifest.kind !== "piclaw.native-recovery-unit" || manifest.database?.file !== "database.sqlite" ||
    !Array.isArray(manifest.references) || !Array.isArray(manifest.answerFiles)) throw Error("Unsupported recovery manifest");
  if (JSON.stringify(environmentProof(environment)) !== JSON.stringify(manifest.environment)) throw Error("Recovery dependency mismatch");
  const check = (file: StoredFile) => {
    const knownPath = file.file === "database.sqlite" || file.file.startsWith("payloads/") && isHash(file.file.slice(9)) || file.file.startsWith("artifacts/") && isHash(file.file.slice(10));
    if (!knownPath || !isHash(file.sha256) || !Number.isSafeInteger(file.byteLength) || file.byteLength < 0) throw Error("Invalid recovery file manifest");
    if (JSON.stringify(fingerprint(join(unit,file.file))) !== JSON.stringify({ sha256: file.sha256, byteLength: file.byteLength })) throw Error("Recovery file missing or corrupt");
  };
  exactFields(manifest.database,["file","sha256","byteLength","verification"]);
  for (const file of manifest.answerFiles) exactFields(file,["file","sha256","byteLength"]);
  for (const reference of manifest.references) {
    exactFields(reference,["owner","location","mediaType","redactionClass","referenceSha256","file","sha256","byteLength"]);
    if (typeof reference.mediaType !== "string" || !reference.mediaType || reference.mediaType.length > 2048 || /[\r\n\0]/.test(reference.mediaType)) throw Error("Invalid recovery payload media type");
  }
  check(manifest.database);
  if (manifest.answerFiles.some(row => !row.file.startsWith("payloads/") || !isHash(row.file.slice(9))) || new Set(manifest.answerFiles.map(row => row.file)).size !== manifest.answerFiles.length)
    throw Error("Invalid answer-store inventory");
  for (const file of [...manifest.answerFiles, ...manifest.references]) check(file);
  if (JSON.stringify(verifySqliteBackup(join(unit,"database.sqlite"))) !== JSON.stringify(manifest.database.verification)) throw Error("Recovery database fingerprint mismatch");
  const db = readonly(join(unit,"database.sqlite"));
  try {
    const proof = databaseProof(db);
    if (proof.schemaSha256 !== manifest.schemaSha256 || proof.bindingsSha256 !== manifest.bindingsSha256) throw Error("Recovery binding/schema mismatch");
    const actual = await snapshotReferences(join(unit,"database.sqlite"),db);
    const listed = manifest.references.map(({ owner,referenceSha256,location,redactionClass }) => ({ owner,referenceSha256,location,redactionClass }));
    if (JSON.stringify(actual.map(({ owner,ref,location,redactionClass }) => ({ owner,referenceSha256:sha(ref),location,redactionClass }))) !== JSON.stringify(listed)) throw Error("Incomplete recovery reference closure");
    for (const reference of actual) {
      const stored = manifest.references.find(row => row.owner === reference.owner && row.referenceSha256 === sha(reference.ref))!;
      if(reference.owner==='native-background-input')verifyBackgroundRecoveryPayload(db,reference.ref,new TextDecoder('utf-8',{fatal:true}).decode(bytes(join(unit,stored.file))));
      if (stored.file !== (reference.location === "answers" ? `payloads/${sha(reference.ref)}` : `artifacts/${sha(reference.ref)}`) ||
        reference.mediaType !== undefined && reference.mediaType !== stored.mediaType ||
        reference.sha256 !== undefined && (reference.sha256 !== stored.sha256 || reference.byteLength !== stored.byteLength)) throw Error("Recovery reference binding mismatch");
    }
    const names = readdirSync(join(unit,"payloads")).sort();
    if (JSON.stringify(names) !== JSON.stringify(manifest.answerFiles.map(row => row.file.slice("payloads/".length)).sort())) throw Error("Incomplete answer-store inventory");
    const artifacts = [...new Set(manifest.references.filter(row => row.location !== "answers").map(row => row.file.slice("artifacts/".length)))].sort();
    if (JSON.stringify(readdirSync(join(unit,"artifacts")).sort()) !== JSON.stringify(artifacts) ||
      JSON.stringify(readdirSync(unit).sort()) !== JSON.stringify(["artifacts","database.sqlite","manifest.json","payloads"])) throw Error("Unexpected recovery artefact");
    check(manifest.database);
    for (const file of [...manifest.answerFiles, ...manifest.references]) check(file);
    if (JSON.stringify(environmentProof(environment)) !== JSON.stringify(manifest.environment)) throw Error("Recovery dependencies changed during verification");
    if (sha(bytes(join(unit,"manifest.json"))) !== manifestSha256) throw Error("Recovery manifest changed during verification");
    return manifest;
  } finally { db.close(); }
}
