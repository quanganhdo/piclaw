import { describe, expect, test } from "bun:test";
import "../helpers.js";
import { createFakeExtensionApi } from "./fake-extension-api.js";

describe("local-lite prompt profile", () => {
  test("detects local and private OpenAI-compatible models", async () => {
    const { isLocalLitePromptModel } = await import("../../src/extensions/local-lite-prompt-profile.js");

    expect(isLocalLitePromptModel({ provider: "llama-cpp", baseUrl: "https://example.com" })).toBe(true);
    expect(isLocalLitePromptModel({ provider: "ollama", baseUrl: "https://example.com" })).toBe(true);
    expect(isLocalLitePromptModel({ provider: "openai-compatible", baseUrl: "http://sandbox.local:8090/v1" })).toBe(true);
    expect(isLocalLitePromptModel({ provider: "milkv-local", baseUrl: "http://milkv.local:8090/v1" })).toBe(true);
    expect(isLocalLitePromptModel({ provider: "openai-compatible", baseUrl: "http://192.168.1.10:8090/v1" })).toBe(true);
    expect(isLocalLitePromptModel({ provider: "custom", baseUrl: "http://10.1.2.3:8090/v1" })).toBe(true);
    expect(isLocalLitePromptModel({ provider: "github-copilot", baseUrl: "https://api.githubcopilot.com" })).toBe(false);
    expect(isLocalLitePromptModel(undefined)).toBe(false);
  });

  test("builds compact prompt with context pointers instead of full context content", async () => {
    const { buildLocalLiteSystemPrompt } = await import("../../src/extensions/local-lite-prompt-profile.js");

    const prompt = buildLocalLiteSystemPrompt({
      cwd: "/workspace",
      selectedTools: ["list_tools", "activate_tools", "read"],
      toolSnippets: {
        list_tools: "Discover available tools.",
        activate_tools: "Enable selected tools.",
        read: "Read a file.",
      },
      contextFiles: [
        { path: "/workspace/AGENTS.md", content: "SECRETLY HUGE POLICY BODY THAT SHOULD NOT BE INCLUDED" },
      ],
      skills: [
        { name: "web-search", description: "A long skill description", path: "/skills/web-search/SKILL.md" } as any,
      ],
    }, {
      provider: "openai-compatible",
      id: "gemma4-e2b-qat-mtp",
      name: "gemma4-e2b-qat-mtp",
      baseUrl: "http://sandbox.local:8090/v1",
    }, new Date("2026-06-27T00:00:00Z"));

    expect(prompt).toContain("local-lite prompt profile");
    expect(prompt).toContain("openai-compatible/gemma4-e2b-qat-mtp");
    expect(prompt).toContain("- /workspace/AGENTS.md");
    expect(prompt).toContain("read the relevant context file(s)");
    expect(prompt).toContain("Current date: 2026-06-27");
    expect(prompt).not.toContain("SECRETLY HUGE POLICY BODY");
    expect(prompt).not.toContain("web-search");
  });

  test("shrinks active tools on local model and restores them after hosted model selection", async () => {
    const { createLocalLitePromptProfile } = await import("../../src/extensions/local-lite-prompt-profile.js");
    const fake = createFakeExtensionApi({
      allTools: [
        { name: "list_tools" },
        { name: "activate_tools" },
        { name: "read" },
        { name: "bash" },
        { name: "edit" },
        { name: "messages" },
      ],
      activeTools: ["read", "bash", "edit", "messages", "list_tools", "activate_tools"],
    });

    createLocalLitePromptProfile(() => true)(fake.api);

    const sessionStart = fake.handlers.find((entry) => entry.event === "session_start");
    const modelSelect = fake.handlers.find((entry) => entry.event === "model_select");
    expect(sessionStart).toBeDefined();
    expect(modelSelect).toBeDefined();

    await sessionStart!.handler({}, {
      model: {
        provider: "openai-compatible",
        id: "gemma4-e2b-qat-mtp",
        name: "gemma4-e2b-qat-mtp",
        baseUrl: "http://sandbox.local:8090/v1",
      },
    });

    expect(fake.api.getActiveTools()).toEqual(["list_tools", "activate_tools", "read"]);

    await modelSelect!.handler({}, {
      model: {
        provider: "github-copilot",
        id: "gpt-5.5",
        name: "gpt-5.5",
        baseUrl: "https://api.githubcopilot.com",
      },
    });

    expect(fake.api.getActiveTools()).toEqual(["read", "bash", "edit", "messages", "list_tools", "activate_tools"]);
  });

  test("rewrites system prompt only for local models", async () => {
    const { createLocalLitePromptProfile } = await import("../../src/extensions/local-lite-prompt-profile.js");
    const fake = createFakeExtensionApi({
      allTools: [{ name: "list_tools" }, { name: "activate_tools" }, { name: "read" }],
      activeTools: ["list_tools", "activate_tools", "read"],
    });

    createLocalLitePromptProfile(() => true)(fake.api);
    const beforeAgentStart = fake.handlers.find((entry) => entry.event === "before_agent_start");
    expect(beforeAgentStart).toBeDefined();

    const event = {
      type: "before_agent_start",
      prompt: "hi",
      systemPrompt: "FULL PROMPT",
      systemPromptOptions: {
        cwd: "/workspace",
        selectedTools: ["list_tools", "activate_tools", "read"],
        toolSnippets: { read: "Read files." },
        contextFiles: [{ path: "/workspace/AGENTS.md", content: "FULL AGENTS" }],
      },
    };

    const localResult = await beforeAgentStart!.handler(event, {
      model: {
        provider: "openai-compatible",
        id: "gemma4-e2b-qat-mtp",
        name: "gemma4-e2b-qat-mtp",
        baseUrl: "http://sandbox.local:8090/v1",
      },
    });
    expect(localResult.systemPrompt).toContain("local-lite prompt profile");
    expect(localResult.systemPrompt).not.toContain("FULL AGENTS");

    const hostedResult = await beforeAgentStart!.handler(event, {
      model: {
        provider: "github-copilot",
        id: "gpt-5.5",
        name: "gpt-5.5",
        baseUrl: "https://api.githubcopilot.com",
      },
    });
    expect(hostedResult).toBeUndefined();

    const missingContextResult = await beforeAgentStart!.handler(event);
    expect(missingContextResult).toBeUndefined();
  });
});

test("disabled local-lite preserves prompt and tools and restores tools when switched off", async () => {
  const { createLocalLitePromptProfile } = await import("../../src/extensions/local-lite-prompt-profile.js");
  const fake = createFakeExtensionApi();
  let enabled = false;
  const normal = ["read", "bash", "edit", "list_tools", "activate_tools"];
  fake.api.getAllTools = () => normal.map(name => ({ name, label: name, description: name, parameters: {} } as any));
  fake.api.setActiveTools(normal);
  createLocalLitePromptProfile(() => enabled)(fake.api);
  const ctx: any = { model: { provider: "ollama", baseUrl: "http://192.168.1.2:11434/v1" } };
  const before = fake.handlers.find(h => h.event === "before_agent_start")!;
  const event: any = { systemPromptOptions: { cwd: "/workspace", selectedTools: normal } };
  expect(await before.handler(event, ctx)).toBeUndefined();
  expect(fake.api.getActiveTools()).toEqual(normal);
  enabled = true;
  expect(await before.handler(event, ctx)).toBeDefined();
  expect(fake.api.getActiveTools()).toEqual(["list_tools", "activate_tools", "read"]);
  enabled = false;
  expect(await before.handler(event, ctx)).toBeUndefined();
  expect(fake.api.getActiveTools()).toEqual(normal);
});
