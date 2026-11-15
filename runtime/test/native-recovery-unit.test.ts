import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureNativeRecoveryUnit, fingerprintRecoveryFile, fingerprintSqliteTables, nativeRecoveryManifestSha256, verifyNativeRecoveryUnit, type RecoveryEnvironment } from "../scripts/lib/native-recovery-unit.js";

function fixture() {
  const root=mkdtempSync(join(process.env.PICLAW_WORKSPACE!,"unit-boundary-"));
  const source=join(root,"source.sqlite"), output=join(root,"output");
  writeFileSync(source,"",{mode:0o600});
  let probes=0;
  const environment:RecoveryEnvironment={runtime:{coreRevision:"0".repeat(40),sdkVersion:"1.4.0",bunVersion:"1.4.4"},addonWorkspace:root,
    configurations:[{id:"settings",path:join(root,"settings.json")}],credentialReferences:["fixture/keychain"],credentialReferenceAvailable(){probes++;return true;}};
  return {root,source,output,environment,get probes(){return probes;},close(){rmSync(root,{recursive:true,force:true});}};
}
test("recovery unit rejects live profile paths before reading files, probing credentials or creating output",async()=>{
  const f=fixture();
  try {
    for(const database of ["/workspace/.piclaw/store/messages.db",join(f.root,".pi/store/messages.db")])
      await expect(captureNativeRecoveryUnit({database,answers:f.root,workspace:f.root,output:f.output,environment:f.environment})).rejects.toThrow("offline copies");
    await expect(verifyNativeRecoveryUnit("/workspace/.piclaw",f.environment)).rejects.toThrow("offline copies");
    expect(()=>nativeRecoveryManifestSha256("/workspace/.pi")).toThrow("offline copies");
    expect(f.probes).toBe(0); expect(existsSync(f.output)).toBe(false);
  }finally{f.close();}
});
test("recovery unit refuses source file aliases instead of adopting a symlink or hard link",async()=>{
  const f=fixture();
  try {
    const alias=join(f.root,"alias.sqlite"); symlinkSync(f.source,alias);
    await expect(captureNativeRecoveryUnit({database:alias,answers:f.root,workspace:f.root,output:f.output,environment:f.environment})).rejects.toThrow("symlink");
    rmSync(alias);linkSync(f.source,alias);
    await expect(captureNativeRecoveryUnit({database:alias,answers:f.root,workspace:f.root,output:f.output,environment:f.environment})).rejects.toThrow("Exclusive regular");
    expect(f.probes).toBe(0);expect(existsSync(f.output)).toBe(false);
  }finally{f.close();}
});
test("recovery unit refuses aliased/nonprivate containers before parsing a manifest",async()=>{
  const f=fixture();
  try {
    const real=join(f.root,"real"),alias=join(f.root,"alias");mkdirSync(real,{mode:0o700});symlinkSync(real,alias);
    await expect(verifyNativeRecoveryUnit(alias,f.environment)).rejects.toThrow("directory binding");
    const publicDir=join(f.root,"public");mkdirSync(publicDir,{mode:0o755});
    await expect(verifyNativeRecoveryUnit(publicDir,f.environment)).rejects.toThrow("directory binding");
    expect(f.probes).toBe(0);
  }finally{f.close();}
});
test("recovery unit fingerprints large files and primary-key ordered rows without whole-database buffering",async()=>{
  const f=fixture(), db=new Database(":memory:");
  try {
    const data=Buffer.alloc(4*1024*1024,123);writeFileSync(f.source,data);
    expect(fingerprintRecoveryFile(f.source)).toEqual({sha256:createHash("sha256").update(data).digest("hex"),byteLength:data.length});
    db.exec("CREATE TABLE indexed(k TEXT PRIMARY KEY,v BLOB) WITHOUT ROWID; INSERT INTO indexed VALUES('b',x'00ff'),('a',x'01');");
    const first=fingerprintSqliteTables(db,["indexed"]);
    db.exec("DELETE FROM indexed; INSERT INTO indexed VALUES('a',x'01'),('b',x'00ff');");
    expect(fingerprintSqliteTables(db,["indexed"])).toBe(first);
    db.exec("UPDATE indexed SET v=x'02' WHERE k='a'");
    expect(fingerprintSqliteTables(db,["indexed"])).not.toBe(first);
  }finally{db.close();f.close();}
});
