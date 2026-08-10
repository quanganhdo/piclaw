import { expect, test } from "bun:test";

import { resolveMediaAttachments } from "../../web/static/visual/frontend/src/utils/attachments.ts";

test("resolveMediaAttachments preserves names across file refs, existing media, and uploads", async () => {
  const uploadCalls: string[] = [];
  const file = new File(["image"], "new-image.png", { type: "image/png" });

  const resolved = await resolveMediaAttachments([
    { name: "workspace.md", isFileRef: true },
    { id: 41, name: "existing.png" },
    { name: "new-image.png", file },
  ], async (pendingFile) => {
    uploadCalls.push(pendingFile.name);
    return { id: 42 };
  });

  expect(uploadCalls).toEqual(["new-image.png"]);
  expect(resolved).toEqual([
    { id: 41, name: "existing.png" },
    { id: 42, name: "new-image.png" },
  ]);
});

test("resolveMediaAttachments propagates upload failures instead of dropping attachments", async () => {
  const file = new File(["document"], "large.pdf", { type: "application/pdf" });

  await expect(resolveMediaAttachments([
    { name: "large.pdf", file },
  ], async () => {
    throw new Error("Upload failed for large.pdf");
  })).rejects.toThrow("Upload failed for large.pdf");
});

test("resolveMediaAttachments rejects invalid upload responses", async () => {
  const file = new File(["document"], "large.pdf", { type: "application/pdf" });

  await expect(resolveMediaAttachments([
    { name: "large.pdf", file },
  ], async () => ({}))).rejects.toThrow("Upload failed for “large.pdf”");
});
