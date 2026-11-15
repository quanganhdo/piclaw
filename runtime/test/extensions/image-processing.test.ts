/**
 * test/extensions/image-processing.test.ts – Tests for the image_process tool.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import "../helpers.js";
import { createTempWorkspace, setEnv } from "../helpers.js";

describe("image_process tool", () => {
  let ws: ReturnType<typeof createTempWorkspace>;
  let restoreEnv: (() => void) | null = null;

  function makeFakeApi() {
    const tools = new Map<string, any>();
    return {
      api: {
        on() {},
        registerTool(tool: any) { tools.set(tool.name, tool); },
        registerCommand() {},
        registerShortcut() {},
        registerFlag() {},
        getFlag() { return undefined; },
        registerMessageRenderer() {},
        sendMessage() {},
        sendUserMessage() {},
        appendEntry() {},
        setSessionName() {},
        getSessionName() { return undefined; },
        setLabel() {},
        exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        getActiveTools: () => [],
        getAllTools: () => [],
        setActiveTools() {},
        getCommands: () => [],
        setModel: async () => true,
        getThinkingLevel: () => "off" as any,
        setThinkingLevel() {},
        registerProvider() {},
        unregisterProvider() {},
      },
      tools,
    };
  }

  async function createTestImage(dir: string, name: string, options: { width: number; height: number; channels?: 3 | 4; alpha?: boolean } = { width: 100, height: 100 }) {
    const { width, height, channels = 4 } = options;
    const filePath = join(dir, name);
    const img = await sharp({
      create: { width, height, channels, background: { r: 255, g: 0, b: 0, alpha: channels === 4 ? 0.5 : 1 } },
    }).png().toBuffer();
    writeFileSync(filePath, img);
    return filePath;
  }

  afterEach(() => {
    restoreEnv?.();
    restoreEnv = null;
  });

  test("registers the image_process tool", async () => {
    const { imageProcessing } = await import("../../src/extensions/image-processing.js");
    const fake = makeFakeApi();
    imageProcessing(fake.api as any);
    expect(fake.tools.has("image_process")).toBe(true);
  });

  test("info action returns image metadata", async () => {
    ws = createTempWorkspace("piclaw-imgproc-");
    restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace });

    await createTestImage(ws.workspace, "test.png", { width: 200, height: 150 });

    const { imageProcessing } = await import("../../src/extensions/image-processing.js");
    const fake = makeFakeApi();
    imageProcessing(fake.api as any);

    const tool = fake.tools.get("image_process");
    const result = await tool.execute("t1", { action: "info", input: join(ws.workspace, "test.png") });

    expect(result.details.width).toBe(200);
    expect(result.details.height).toBe(150);
    expect(result.details.format).toBe("png");
    expect(result.details.hasAlpha).toBe(true);
  });

  test("resize action creates a resized image", async () => {
    ws = createTempWorkspace("piclaw-imgproc-");
    restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace });

    await createTestImage(ws.workspace, "big.png", { width: 800, height: 600 });

    const { imageProcessing } = await import("../../src/extensions/image-processing.js");
    const fake = makeFakeApi();
    imageProcessing(fake.api as any);

    const tool = fake.tools.get("image_process");
    const result = await tool.execute("t2", { action: "resize", input: join(ws.workspace, "big.png"), width: 200 });

    expect(result.details.width).toBe(200);
    expect(result.details.height).toBe(150);
    expect(result.details.action).toBe("resize");
    expect(existsSync(result.details.output) || existsSync(join(ws.workspace, result.details.output))).toBe(true);
  }, 30_000); // Cold native/subprocess setup under the bounded CI CPU quota.

  test("convert action changes format and preserves transparency", async () => {
    ws = createTempWorkspace("piclaw-imgproc-");
    restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace });

    await createTestImage(ws.workspace, "input.png", { width: 50, height: 50 });

    const { imageProcessing } = await import("../../src/extensions/image-processing.js");
    const fake = makeFakeApi();
    imageProcessing(fake.api as any);

    const tool = fake.tools.get("image_process");
    const result = await tool.execute("t3", { action: "convert", input: join(ws.workspace, "input.png"), format: "webp", output: join(ws.workspace, "output.webp") });

    expect(result.details.format).toBe("webp");
    expect(result.details.mimeType).toBe("image/webp");

    // Verify transparency preserved
    const meta = await sharp(join(ws.workspace, "output.webp")).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  test("optimize action reduces file size", async () => {
    ws = createTempWorkspace("piclaw-imgproc-");
    restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace });

    // Create a larger image that benefits from optimization
    const largePng = await sharp({
      create: { width: 500, height: 500, channels: 3, background: { r: 128, g: 64, b: 200 } },
    }).png({ compressionLevel: 0 }).toBuffer();
    writeFileSync(join(ws.workspace, "unoptimized.png"), largePng);

    const { imageProcessing } = await import("../../src/extensions/image-processing.js");
    const fake = makeFakeApi();
    imageProcessing(fake.api as any);

    const tool = fake.tools.get("image_process");
    const result = await tool.execute("t4", { action: "optimize", input: join(ws.workspace, "unoptimized.png"), format: "webp", quality: 60 });

    expect(result.details.savings).toBeGreaterThan(0);
    expect(result.details.format).toBe("webp");
  });

  test("trim action removes transparent pixels", async () => {
    ws = createTempWorkspace("piclaw-imgproc-");
    restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace });

    // Create image with transparent padding
    const img = await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{
      input: await sharp({
        create: { width: 50, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
      }).png().toBuffer(),
      left: 75,
      top: 75,
    }]).png().toBuffer();
    writeFileSync(join(ws.workspace, "padded.png"), img);

    const { imageProcessing } = await import("../../src/extensions/image-processing.js");
    const fake = makeFakeApi();
    imageProcessing(fake.api as any);

    const tool = fake.tools.get("image_process");
    const result = await tool.execute("t5", { action: "trim", input: join(ws.workspace, "padded.png") });

    // Trimmed image should be smaller than 200x200
    expect(result.details.width).toBeLessThan(200);
    expect(result.details.height).toBeLessThan(200);
  });

  test("returns error for missing files", async () => {
    ws = createTempWorkspace("piclaw-imgproc-");
    restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace });

    const { imageProcessing } = await import("../../src/extensions/image-processing.js");
    const fake = makeFakeApi();
    imageProcessing(fake.api as any);

    const tool = fake.tools.get("image_process");
    const result = await tool.execute("t6", { action: "info", input: join(ws.workspace, "nonexistent.png") });
    expect(result.details.error).toBe("not_found");
  });

test("spritesheet_to_gif creates an animated GIF from a horizontal strip", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-anim-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });

  // Create a 150x50 horizontal strip (3 frames of 50x50)
  await sharp({
    create: { width: 150, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
  .composite([
    { input: await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 0, top: 0 },
    { input: await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer(), left: 50, top: 0 },
    { input: await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer(), left: 100, top: 0 },
  ])
  .png().toFile(join(ws2.workspace, "strip.png"));

  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);

  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-anim", {
    action: "spritesheet_to_gif",
    input: join(ws2.workspace, "strip.png"),
    frame_count: 3,
    delay: 200,
    loop: 0,
  });

  expect(result.details.action).toBe("spritesheet_to_gif");
  expect(result.details.frameCount).toBe(3);
  expect(result.details.width).toBe(50);
  expect(result.details.height).toBe(50);
  expect(result.details.format).toBe("gif");

  // Verify with sharp that it's actually animated
  const gifMeta = await sharp(result.details.output.startsWith("/") ? result.details.output : join(ws2.workspace, result.details.output), { animated: true }).metadata();
  expect(gifMeta.pages).toBe(3);

  ws2.cleanup();
});

test("spritesheet_to_gif supports vertical strips", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-vert-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });

  // Create a 50x100 vertical strip (2 frames of 50x50)
  await sharp({
    create: { width: 50, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
  .composite([
    { input: await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 255, g: 255, b: 0, alpha: 1 } } }).png().toBuffer(), left: 0, top: 0 },
    { input: await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 255, b: 255, alpha: 1 } } }).png().toBuffer(), left: 0, top: 50 },
  ])
  .png().toFile(join(ws2.workspace, "vstrip.png"));

  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);

  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-vert", {
    action: "spritesheet_to_gif",
    input: join(ws2.workspace, "vstrip.png"),
    frame_count: 2,
    direction: "vertical",
    delay: [150, 300],
  });

  expect(result.details.frameCount).toBe(2);
  expect(result.details.delay).toEqual([150, 300]);

  ws2.cleanup();
});

test("greyscale action converts to greyscale", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-grey-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });

  await createTestImage(ws2.workspace, "color.png", { width: 50, height: 50 });

  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);

  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-grey", { action: "greyscale", input: join(ws2.workspace, "color.png") });
  expect(result.details.action).toBe("greyscale");
  ws2.cleanup();
});

test("modulate action adjusts brightness and saturation", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-mod-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });

  await createTestImage(ws2.workspace, "photo.png", { width: 50, height: 50 });

  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);

  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-mod", {
    action: "modulate",
    input: join(ws2.workspace, "photo.png"),
    brightness: 1.3,
    saturation: 0.5,
  });
  expect(result.details.action).toBe("modulate");
  ws2.cleanup();
});

test("sharpen action accepts a sigma with Sharp 0.35", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-sharpen-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });

  await createTestImage(ws2.workspace, "soft.png", { width: 50, height: 50 });

  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);

  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-sharpen", {
    action: "sharpen",
    input: join(ws2.workspace, "soft.png"),
    sigma: 1.5,
  });
  expect(result.details.action).toBe("sharpen");
  ws2.cleanup();
});

test("normalize action applies auto-level", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-norm-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });

  await createTestImage(ws2.workspace, "dark.png", { width: 50, height: 50 });

  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);

  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-norm", { action: "normalize", input: join(ws2.workspace, "dark.png") });
  expect(result.details.action).toBe("normalize");
  ws2.cleanup();
});

test("negate action inverts colors", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-neg-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });

  await createTestImage(ws2.workspace, "input.png", { width: 50, height: 50 });

  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);

  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-neg", { action: "negate", input: join(ws2.workspace, "input.png") });
  expect(result.details.action).toBe("negate");
  ws2.cleanup();
});

test("threshold action creates binary image", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-thresh-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });
  await createTestImage(ws2.workspace, "input.png", { width: 50, height: 50 });
  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);
  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-thresh", { action: "threshold", input: join(ws2.workspace, "input.png"), threshold_value: 100 });
  expect(result.details.action).toBe("threshold");
  ws2.cleanup();
});

test("extend action adds padding", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-ext-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });
  await createTestImage(ws2.workspace, "small.png", { width: 50, height: 50 });
  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);
  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-ext", { action: "extend", input: join(ws2.workspace, "small.png"), extend_top: 10, extend_bottom: 10, extend_left: 10, extend_right: 10, extend_background: "#FF000080" });
  expect(result.details.width).toBe(70);
  expect(result.details.height).toBe(70);
  ws2.cleanup();
});

test("extract_channel action isolates a single channel", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-chan-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });
  await createTestImage(ws2.workspace, "rgb.png", { width: 50, height: 50 });
  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);
  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-chan", { action: "extract_channel", input: join(ws2.workspace, "rgb.png"), channel: 0 });
  expect(result.details.action).toBe("extract_channel");
  ws2.cleanup();
});

test("text action overlays text on image", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-text-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });
  await createTestImage(ws2.workspace, "bg.png", { width: 200, height: 100 });
  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);
  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-text", { action: "text", input: join(ws2.workspace, "bg.png"), text: "Hello World", text_color: "#FFFFFF", text_size: 20 });
  expect(result.details.action).toBe("text");
  ws2.cleanup();
}, 30_000); // Cold native/subprocess setup under the bounded CI CPU quota.

test("metadata action returns detailed image metadata", async () => {
  const ws2 = createTempWorkspace("piclaw-imgproc-meta-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws2.workspace });
  await createTestImage(ws2.workspace, "test.png", { width: 100, height: 100 });
  const { imageProcessing } = await import("../../src/extensions/image-processing.js");
  const fake = makeFakeApi();
  imageProcessing(fake.api as any);
  const tool = fake.tools.get("image_process");
  const result = await tool.execute("t-meta", { action: "metadata", input: join(ws2.workspace, "test.png") });
  expect(result.details.action).toBe("metadata");
  expect(result.details.width).toBe(100);
  expect(result.details.format).toBe("png");
  ws2.cleanup();
});
});
