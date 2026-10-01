import { afterEach, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import "../../helpers.js";
import { importFresh, withTempWorkspaceEnv } from "../../helpers.js";

let closeDatabase: (() => void) | undefined;
afterEach(() => closeDatabase?.());

const owner = Object.freeze({
  kind: "local", userId: "default", username: "default", displayName: "Owner",
  role: "admin", mode: "single-user", homeChatJid: "web:default",
  authentication: Object.freeze({ method: "local", sessionId: null, expiresAt: null }),
});

function channel(principal: unknown = owner, authEnabled = false) {
  return {
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    authGateway: {
      isAuthEnabled: () => authEnabled,
      isInternalSecretEnabled: () => false,
      verifyInternalSecret: () => false,
      isAuthenticated: () => principal !== null,
      getPrincipal: () => principal,
    },
  } as any;
}

test("workspace indexing API is owner-only and denied in family and isolated modes", async () => {
  await withTempWorkspaceEnv("workspace-index-api-", {
    PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1",
  }, async () => {
    const db = await import("../../../src/db/connection.js");
    closeDatabase = db.closeDatabase;
    db.initDatabase();
    const { RequestRouterService } = await importFresh<typeof import("../../../src/channels/web/request-router-service.js")>(
      "../src/channels/web/request-router-service.js",
    );

    const path = "https://local/agent/settings/workspace/indexing";
    const ownerResponse = await new RequestRouterService(channel()).handle(new Request(path));
    expect(ownerResponse.status).toBe(200);
    expect(await ownerResponse.json()).toMatchObject({ ok: true, policy: { roots: ["notes", ".pi/skills"] } });

    const anonymous = await new RequestRouterService(channel(null, true)).handle(new Request(path));
    expect(anonymous.status).not.toBe(200);

    for (const mode of ["family-shared", "isolated-containers"] as const) {
      const denied = await new RequestRouterService(channel(), mode).handle(new Request(path));
      expect(denied.status).toBe(403);
    }
  });
}, 20_000);

test("workspace indexing preview is bounded, filters unsupported files and never follows symlinks", async () => {
  await withTempWorkspaceEnv("workspace-index-preview-", {}, async ({ workspace }) => {
    const safetyRoot = join(workspace, "preview-safety");
    mkdirSync(safetyRoot, { recursive: true });
    writeFileSync(join(safetyRoot, "target.md"), "content is never needed for preview");
    symlinkSync(join(safetyRoot, "target.md"), join(safetyRoot, "link.md"));
    writeFileSync(join(safetyRoot, "image.png"), "not indexable text");
    writeFileSync(join(safetyRoot, "too-large.md"), Buffer.alloc(512 * 1024 + 1));

    const indexing = await importFresh<typeof import("../../../src/channels/web/workspace/indexing.js")>(
      "../src/channels/web/workspace/indexing.js",
    );
    const safety = await indexing.previewWorkspaceIndexPolicy({ roots: ["preview-safety"], ignorePatterns: [] });
    expect(safety.includedFiles).toBe(1);
    expect(safety.samples).toContainEqual(expect.objectContaining({
      path: "preview-safety/link.md", included: false, type: "symlink",
    }));
    expect(safety.samples).toContainEqual(expect.objectContaining({
      path: "preview-safety/image.png", included: false, reason: "File type is not supported by workspace indexing.",
    }));
    expect(safety.samples).toContainEqual(expect.objectContaining({
      path: "preview-safety/too-large.md", included: false, reason: "File exceeds the 512 KiB indexing limit.",
    }));

    const hugeRoot = join(workspace, "preview-huge");
    mkdirSync(hugeRoot, { recursive: true });
    for (let index = 0; index < 2_100; index += 1) {
      writeFileSync(join(hugeRoot, `file-${String(index).padStart(4, "0")}.md`), "x");
    }
    const bounded = await indexing.previewWorkspaceIndexPolicy({ roots: ["preview-huge"], ignorePatterns: [] });
    expect(bounded.truncated).toBe(true);
    expect(bounded.scannedEntries).toBeLessThanOrEqual(indexing.WORKSPACE_INDEX_PREVIEW_LIMITS.maxEntries);
    expect(bounded.samples.length).toBeLessThanOrEqual(indexing.WORKSPACE_INDEX_PREVIEW_LIMITS.maxSamples);
  });
}, 20_000);


test('indexing API rejects oversized/invalid payloads and revoked owner during body read',async()=>{
 await withTempWorkspaceEnv('index-api-body-',{PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},async()=>{
  const db=await importFresh<typeof import('../../../src/db/connection.js')>('../src/db/connection.js');closeDatabase=db.closeDatabase;db.initDatabase();
  const {handleWorkspaceIndexingSettings}=await import('../../../src/channels/web/handlers/workspace-indexing.js');
  const {getWorkspaceIndexPolicy}=await import('../../../src/core/workspace-index-policy.js');
  const base='https://local/agent/settings/workspace/indexing';
  const send=(suffix:string,body:string)=>handleWorkspaceIndexingSettings(channel(),new Request(base+suffix,{method:'POST',body}),new URL(base+suffix));
  expect((await send('/save','x'.repeat(32769)))!.status).toBe(400);
  expect((await send('/save',JSON.stringify({roots:['../bad'],ignorePatterns:[]})))!.status).toBe(400);
  expect(getWorkspaceIndexPolicy().roots).toEqual(['notes','.pi/skills']);
  const revoked=channel();let admitted=true,refreshed=0;
  // Production caches by Request unless refresh=true is explicitly requested.
  revoked.authGateway.getPrincipal=(_req:Request,refresh=false)=>{if(refresh)refreshed++;return !refresh||admitted?owner:null;};
  const body=new ReadableStream({pull(controller){admitted=false;controller.enqueue(new TextEncoder().encode(JSON.stringify({roots:[],ignorePatterns:[]})));controller.close();}});
  const denied=await handleWorkspaceIndexingSettings(revoked,new Request(base+'/save',{method:'POST',body}),new URL(base+'/save'));
  expect(denied!.status).toBe(403);expect(refreshed).toBeGreaterThan(1);expect(getWorkspaceIndexPolicy().roots).toEqual(['notes','.pi/skills']);
  expect((await send('/save',JSON.stringify({roots:[],ignorePatterns:[]})))!.status).toBe(200);
  expect(getWorkspaceIndexPolicy().roots).toEqual([]);
  expect((await send('/refresh','{}'))!.status).toBe(202);
 });
});
