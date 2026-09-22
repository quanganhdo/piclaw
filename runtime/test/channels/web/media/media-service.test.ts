import { afterAll, beforeAll, expect, test } from "bun:test";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";

import { getTestWorkspace, setEnv } from "../../../helpers.js";
import { MediaService } from "../../../../src/channels/web/media/media-service.js";

let restoreEnv: (() => void) | null = null;
let db: typeof import("../../../../src/db.js");

beforeAll(async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });

  db = await import("../../../../src/db.js");
  db.initDatabase();
});

afterAll(() => {
  restoreEnv?.();
});

test("createFromPath stores allowed files", async () => {
  const mediaPath = join(process.env.PICLAW_DATA || "/tmp", `media-${Date.now()}.svg`);
  writeFileSync(mediaPath, "<svg xmlns='http://www.w3.org/2000/svg'></svg>");

  const service = new MediaService();
  const res = await service.createFromPath(mediaPath, "image/svg+xml", "inline-test.svg");

  expect(res.status).toBe(200);
  const body = res.body as { id?: number; filename?: string; contentType?: string };
  expect(typeof body.id).toBe("number");
  expect(body.filename).toBe("inline-test.svg");
  expect(body.contentType).toBe("image/svg+xml");

  unlinkSync(mediaPath);
});

test("createFromPath returns 404 for unreadable missing file", async () => {
  const service = new MediaService();
  const missingPath = join(process.env.PICLAW_DATA || "/tmp", `missing-${Date.now()}.png`);

  const res = await service.createFromPath(missingPath, "image/png");
  expect(res.status).toBe(404);
});

test("createFromPath stores general file attachments", async () => {
  const mediaPath = join(process.env.PICLAW_DATA || "/tmp", `media-${Date.now()}.bin`);
  writeFileSync(mediaPath, "not media");

  const service = new MediaService();
  const res = await service.createFromPath(mediaPath, "application/x-msdownload");

  expect(res.status).toBe(200);
  const body = res.body as { id?: number; filename?: string; contentType?: string };
  expect(typeof body.id).toBe("number");
  expect(body.filename).toContain("media-");
  expect(body.contentType).toBe("application/x-msdownload");

  unlinkSync(mediaPath);
});

test("createFromPath infers YAML files as text/yaml", async () => {
  const mediaPath = join(process.env.PICLAW_DATA || "/tmp", `config-${Date.now()}.yaml`);
  writeFileSync(mediaPath, "name: piclaw\nfeatures:\n  preview: true\n");

  const service = new MediaService();
  const res = await service.createFromPath(mediaPath);

  expect(res.status).toBe(200);
  const body = res.body as { contentType?: string };
  expect(body.contentType).toBe("text/yaml");

  unlinkSync(mediaPath);
});

test("createFromPath infers .yml files as text/yaml", async () => {
  const mediaPath = join(process.env.PICLAW_DATA || "/tmp", `config-${Date.now()}.yml`);
  writeFileSync(mediaPath, "name: piclaw\n");

  const service = new MediaService();
  const res = await service.createFromPath(mediaPath);

  expect(res.status).toBe(200);
  const body = res.body as { contentType?: string };
  expect(body.contentType).toBe("text/yaml");

  unlinkSync(mediaPath);
});

test("createFromPath infers shell scripts as text/x-shellscript", async () => {
  const mediaPath = join(process.env.PICLAW_DATA || "/tmp", `script-${Date.now()}.sh`);
  writeFileSync(mediaPath, "#!/bin/sh\necho hello\n");

  const service = new MediaService();
  const res = await service.createFromPath(mediaPath);

  expect(res.status).toBe(200);
  const body = res.body as { contentType?: string };
  expect(body.contentType).toBe("text/x-shellscript");

  unlinkSync(mediaPath);
});

test("createFromPath promotes text-like .sb files to text/plain", async () => {
  const mediaPath = join(process.env.PICLAW_DATA || "/tmp", `notes-${Date.now()}.sb`);
  writeFileSync(mediaPath, "scratch buffer\nsecond line\n");

  const service = new MediaService();
  const res = await service.createFromPath(mediaPath);

  expect(res.status).toBe(200);
  const body = res.body as { contentType?: string };
  expect(body.contentType).toBe("text/plain");

  unlinkSync(mediaPath);
});


test("audio upload and path MIME agree with preview and inline serving", async () => {
  const { getAttachmentPreviewKind } = await import("../../../../web/src/ui/attachment-preview.js");
  const { handleMedia } = await import("../../../../src/channels/web/handlers/media.js");
  const service = new MediaService();
  const channel = { json: (body: unknown, status = 200) => Response.json(body, { status }) };
  for (const [extension, type] of [["mp3", "audio/mpeg"], ["m4a", "audio/mp4"], ["aac", "audio/aac"], ["flac", "audio/flac"], ["opus", "audio/ogg"], ["oga", "audio/ogg"], ["weba", "audio/webm"], ["wav", "audio/wav"]]) {
    const filename = "fixture." + extension;
    const mediaPath = join(process.env.PICLAW_DATA!, filename);
    writeFileSync(mediaPath, "fixture audio bytes");
    try {
      for (const inputType of ["", "application/octet-stream"]) {
        const upload = await service.createFromFile(new File(["fixture audio bytes"], filename, { type: inputType }));
        const path = await service.createFromPath(mediaPath, inputType);
        for (const result of [upload, path]) {
          const body = result.body as { id: number; contentType: string };
          expect(body.contentType).toBe(type);
          const info = service.getInfo(body.id).body as { content_type: string; filename: string };
          expect(info.content_type).toBe(type); expect(getAttachmentPreviewKind(info.content_type, info.filename)).toBe("audio");
          const response = handleMedia(channel, body.id, false);
          expect(response.headers.get("content-type")).toBe(type); expect(response.headers.get("content-disposition")).toBeNull();
        }
      }
    } finally { unlinkSync(mediaPath); }
  }
  for (const [alias, expected] of [["audio/x-wav", "audio/wav"], ["audio/x-m4a", "audio/mp4"], ["audio/x-flac", "audio/flac"], ["audio/mp3", "audio/mpeg"]]) {
    const upload = await service.createFromFile(new File(["bytes"], "unknown.bin", { type: alias }));
    expect((upload.body as { contentType: string }).contentType).toBe(expected);
  }
  const unsafe = await service.createFromFile(new File(["<html>"], "fake.wav", { type: "text/html" }));
  expect((unsafe.body as { contentType: string }).contentType.split(";")[0]).toBe("text/html");
  expect(getAttachmentPreviewKind("text/html", "fake.wav")).not.toBe("audio");
});
