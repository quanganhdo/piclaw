import { describe, expect, test } from "bun:test";
import { handleAgentDebugRequest } from "../../../../src/channels/web/agent/agent-debug.js";

function makeSourceInfo(overrides: Partial<{ path: string; source: string; scope: string; origin: string; baseDir: string }> = {}) {
  return {
    path: overrides.path ?? "/ext/test",
    source: overrides.source ?? "test-source",
    scope: overrides.scope ?? "project",
    origin: overrides.origin ?? "top-level",
    ...(overrides.baseDir ? { baseDir: overrides.baseDir } : {}),
  };
}

function makeExtensionRunner({
  extensions = [],
  tools = [],
  commands = [],
}: {
  extensions?: any[];
  tools?: any[];
  commands?: any[];
} = {}) {
  return {
    extensions,
    getAllRegisteredTools: () => tools,
    getRegisteredCommands: () => commands,
  };
}

function makeSession({
  extensionRunner = null,
  promptTemplates = [],
  skills = [],
}: {
  extensionRunner?: any;
  promptTemplates?: any[];
  skills?: any[];
} = {}) {
  return {
    extensionRunner,
    promptTemplates,
    resourceLoader: { getSkills: () => ({ skills }) },
  };
}

describe("agent debug endpoint", () => {
  test("returns full provenance snapshot with sourceInfo", async () => {
    const si = makeSourceInfo({ path: "/workspace/.pi/extensions/my-ext", source: "my-ext", scope: "user", origin: "package" });
    const toolSi = makeSourceInfo({ path: "/workspace/.pi/extensions/my-ext", source: "my-ext-tool", scope: "project", origin: "top-level" });
    const cmdSi = makeSourceInfo({ path: "/workspace/.pi/extensions/my-ext", source: "my-ext-cmd", scope: "project", origin: "top-level" });
    const templateSi = makeSourceInfo({ path: "/workspace/.pi/prompts/ask.md", source: "ask", scope: "project", origin: "top-level" });
    const skillSi = makeSourceInfo({ path: "/workspace/.pi/skills/web-search/SKILL.md", source: "web-search", scope: "user", origin: "package", baseDir: "/workspace/.pi/skills/web-search" });

    const session = makeSession({
      extensionRunner: makeExtensionRunner({
        extensions: [{
          path: "/workspace/.pi/extensions/my-ext",
          resolvedPath: "/workspace/.pi/extensions/my-ext/index.ts",
          sourceInfo: si,
          commands: new Map([["test", {}]]),
          tools: new Map([["my_tool", {}]]),
          handlers: new Map([["input", [() => {}]]]),
        }],
        tools: [{ definition: { name: "my_tool", description: "A test tool" }, sourceInfo: toolSi }],
        commands: [{ invocationName: "test", name: "test", description: "A test command", sourceInfo: cmdSi }],
      }),
      promptTemplates: [{ name: "ask", description: "Ask template", filePath: "/workspace/.pi/prompts/ask.md", sourceInfo: templateSi }],
      skills: [{
        name: "web-search", description: "Search the web", filePath: "/workspace/.pi/skills/web-search/SKILL.md",
        baseDir: "/workspace/.pi/skills/web-search", sourceInfo: skillSi,
      }],
    });

    const agentPool = { getSessionForIntrospection: async () => session } as any;
    const req = new Request("https://example.com/agent/debug?chat_jid=web:default");

    const res = await handleAgentDebugRequest(req, {
      defaultChatJid: "web:default",
      agentPool,
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Extensions
    expect(body.extensions).toHaveLength(1);
    expect(body.extensions[0].sourceInfo.path).toBe("/workspace/.pi/extensions/my-ext");
    expect(body.extensions[0].sourceInfo.scope).toBe("user");
    expect(body.extensions[0].sourceInfo.origin).toBe("package");
    expect(body.extensions[0].commandCount).toBe(1);
    expect(body.extensions[0].toolCount).toBe(1);
    expect(body.extensions[0].handlerCount).toBe(1);

    // Tools
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe("my_tool");
    expect(body.tools[0].sourceInfo.source).toBe("my-ext-tool");

    // Commands
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0].name).toBe("test");
    expect(body.commands[0].sourceInfo.source).toBe("my-ext-cmd");

    // Prompt templates
    expect(body.promptTemplates).toHaveLength(1);
    expect(body.promptTemplates[0].name).toBe("ask");
    expect(body.promptTemplates[0].sourceInfo.scope).toBe("project");

    // Skills
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].name).toBe("web-search");
    expect(body.skills[0].sourceInfo.scope).toBe("user");
    expect(body.skills[0].sourceInfo.baseDir).toBe("/workspace/.pi/skills/web-search");
  });

  test("returns 404 when no session exists", async () => {
    const agentPool = { getSessionForIntrospection: async () => null } as any;
    const req = new Request("https://example.com/agent/debug");

    const res = await handleAgentDebugRequest(req, {
      defaultChatJid: "web:default",
      agentPool,
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
    });

    expect(res.status).toBe(404);
  });

  test("returns empty arrays when no extension runner is present", async () => {
    const session = makeSession();
    const agentPool = { getSessionForIntrospection: async () => session } as any;
    const req = new Request("https://example.com/agent/debug");

    const res = await handleAgentDebugRequest(req, {
      defaultChatJid: "web:default",
      agentPool,
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
    });

    const body = await res.json() as any;
    expect(body.extensions).toHaveLength(0);
    expect(body.tools).toHaveLength(0);
    expect(body.commands).toHaveLength(0);
    expect(body.promptTemplates).toHaveLength(0);
    expect(body.skills).toHaveLength(0);
  });

  test("omits baseDir from sourceInfo when not present", async () => {
    const si = makeSourceInfo({ path: "/ext/test" });
    const session = makeSession({
      promptTemplates: [{ name: "t", description: "d", filePath: "/t.md", sourceInfo: si }],
    });
    const agentPool = { getSessionForIntrospection: async () => session } as any;
    const req = new Request("https://example.com/agent/debug");

    const res = await handleAgentDebugRequest(req, {
      defaultChatJid: "web:default",
      agentPool,
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
    });

    const body = await res.json() as any;
    expect(body.promptTemplates[0].sourceInfo).not.toHaveProperty("baseDir");
  });
});

test("durable debug uses actual native metadata without constructing a legacy session", async () => {
  const ctx: any = { defaultChatJid: "web:default", agentPool: {
    async getDurableSessionMetadata(chat: string) { expect(chat).toBe("web:native"); return { backend: "durable", conversationId: 42,
      extensions: ["app.host-builtins"], tools: [{ name: "read", description: "Read a file" }] }; },
    async getSessionForIntrospection() { throw Error("Legacy hydration forbidden"); },
  }, json: (payload: unknown, status = 200) => Response.json(payload, { status }) };
  const response = await handleAgentDebugRequest(new Request("http://local/agent/debug?chat_jid=web:native"), ctx);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ backend: "durable", conversationId: 42, extensions: [{ name: "app.host-builtins", sourceInfo: null }],
    tools: [{ name: "read", description: "Read a file", sourceInfo: null }], commands: [], unavailable: ["legacy-extension-provenance", "legacy-extension-commands", "prompt-templates", "skills"] });
});

test("unbound durable debug returns404 without legacy fallback", async () => {
  const ctx: any = { defaultChatJid: "web:default", agentPool: { getDurableSessionMetadata: async () => null,
    getSessionForIntrospection: async () => { throw Error("Legacy fallback forbidden"); } },
    json: (payload: unknown, status = 200) => Response.json(payload, { status }) };
  expect((await handleAgentDebugRequest(new Request("http://local/agent/debug"), ctx)).status).toBe(404);
});

test("native debug metadata failure returns a sanitised unavailable response", async () => {
  const response = await handleAgentDebugRequest(new Request("http://fixture/agent/debug"), {
    defaultChatJid: "web:default", json: (value: unknown, status = 200) => Response.json(value, { status }),
    agentPool: { getDurableSessionMetadata: async () => { throw Error("private native storage detail"); },
      getSessionForIntrospection: async () => { throw Error("Legacy fallback forbidden"); } },
  } as any);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Native debug metadata unavailable" });
});
