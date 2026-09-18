import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAvatarPreview, writeSettingsClipboardText } from "../../web/src/components/settings/general.js";

const runtimeRoot = join(import.meta.dir, "../..");

test("general settings falls back to execCommand when the Clipboard API rejects", async () => {
  const calls: string[] = [];
  const textarea = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute: () => {},
    focus: () => calls.push("focus"),
    select: () => calls.push("select"),
  };
  const body = {
    appendChild: () => calls.push("append"),
    removeChild: () => calls.push("remove"),
  };
  const originalDebug = console.debug;
  const debugCalls: unknown[][] = [];
  console.debug = (...args: unknown[]) => { debugCalls.push(args); };

  try {
    const copied = await writeSettingsClipboardText("secret", {
      navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
      document: {
        body,
        createElement: () => textarea,
        execCommand: (command: string) => {
          calls.push(command);
          return command === "copy";
        },
      },
    });

    expect(copied).toBe(true);
    expect(textarea.value).toBe("secret");
    expect(calls).toEqual(["append", "focus", "select", "copy", "remove"]);
    expect(debugCalls).toHaveLength(1);
    expect(String(debugCalls[0]?.[0])).toContain("falling back to execCommand");
  } finally {
    console.debug = originalDebug;
  }
});

test("general settings previews persisted avatars through the image-serving avatar endpoints", () => {
  expect(resolveAvatarPreview("/workspace/avatars/agent.png", "agent")).toBe("/avatar/agent");
  expect(resolveAvatarPreview("avatars/user.png", "user")).toBe("/avatar/user");
  expect(resolveAvatarPreview("https://example.test/agent.png", "agent")).toBe("/avatar/agent");
  expect(resolveAvatarPreview("/media/42", "user")).toBe("/avatar/user");
});

test("general settings keeps unsaved browser-local avatar previews direct", () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const blobUrl = "blob:https://example.test/avatar";
  expect(resolveAvatarPreview(dataUrl, "agent")).toBe(dataUrl);
  expect(resolveAvatarPreview(blobUrl, "user")).toBe(blobUrl);
  expect(resolveAvatarPreview("", "agent")).toBe("");
  expect(resolveAvatarPreview("avatar.png", "unknown")).toBe("");
});

test("general settings renders automatic or exact recovery budgets in milliseconds", () => {
  const source = readFileSync(join(runtimeRoot, "web/src/components/settings/general.ts"), "utf8");
  expect(source).toContain("settings.general.agentRecovery");
  expect(source).toContain("automaticRecoveryEnabled");
  expect(source).toContain("automaticRecoveryMaxAttempts");
  expect(source).toContain("automaticRecoveryTotalBudgetMs");
  expect(source).toContain("settings.general.recoveryTotalBudgetHint");
  expect(source).toContain("min=${0}");
  expect(source).toContain("fallback=${0}");
  expect(source).toContain("automaticRecoveryEffectiveBudgetMs");
  expect(source).toContain("step=${1000}");
});

test("general settings passes explicit avatar kinds to both identity fields", () => {
  const source = readFileSync(join(runtimeRoot, "web/src/components/settings/general.ts"), "utf8");
  expect(source).toContain('<${AvatarField} kind="user" value=${userAvatar}');
  expect(source).toContain('<${AvatarField} kind="agent" value=${assistantAvatar}');
  expect(source).not.toContain("/workspace/file?path=");
});
