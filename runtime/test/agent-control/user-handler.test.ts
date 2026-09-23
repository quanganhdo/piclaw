/**
 * test/agent-control/user-handler.test.ts
 *
 * Covers /user-name, /user-avatar, and /user-github handler branches.
 */

import { afterEach, expect, test } from "bun:test";

import { createTempWorkspace, importFresh, setEnv } from "../helpers.js";

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;
const originalFetch = globalThis.fetch;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
  cleanupWorkspace?.();
  cleanupWorkspace = null;
  globalThis.fetch = originalFetch;
});

async function setup() {
  const ws = createTempWorkspace("piclaw-user-handler-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });

  return importFresh<typeof import("../src/agent-control/handlers/user.js")>(
    "../src/agent-control/handlers/user.js"
  );
}

test("handleUserName sets, reads, and clears user name", async () => {
  const mod = await setup();

  const read = await mod.handleUserName({} as any, { type: "user_name", raw: "/user-name" } as any);
  expect(read.status).toBe("success");

  const set = await mod.handleUserName({} as any, { type: "user_name", name: "Rui", raw: "/user-name Rui" } as any);
  expect(set.message).toContain("Rui");

  const cleared = await mod.handleUserName({} as any, { type: "user_name", name: "clear", raw: "/user-name clear" } as any);
  expect(cleared.message).toContain("reset to default");
});

test("handleUserAvatar sets and clears avatar", async () => {
  const mod = await setup();

  const set = await mod.handleUserAvatar(
    {} as any,
    { type: "user_avatar", avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSJibHVlIi8+PC9zdmc+", raw: "/user-avatar https://example.com/u.png" } as any
  );
  expect(set.message).toContain("set to");

  const cleared = await mod.handleUserAvatar({} as any, { type: "user_avatar", avatar: "none", raw: "/user-avatar none" } as any);
  expect(cleared.message).toContain("reset to default");
});

test("handleUserGithub validates and handles fetch failures", async () => {
  const mod = await setup();

  const invalid = await mod.handleUserGithub({} as any, { type: "user_github", profile: "https://example.com/not-github" } as any);
  expect(invalid.status).toBe("error");
  expect(invalid.message).toContain("Usage: /user-github");

  const ambiguousInput = await mod.handleUserGithub({} as any, { type: "user_github", profile: "rcarmo extra" } as any);
  expect(ambiguousInput.status).toBe("error");
  expect(ambiguousInput.message).toContain("Usage: /user-github");

  const repoLike = await mod.handleUserGithub({} as any, { type: "user_github", profile: "https://github.com/rcarmo/rcarmo.github.io" } as any);
  expect(repoLike.status).toBe("error");
  expect(repoLike.message).toContain("Usage: /user-github");

  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as any;
  const networkError = await mod.handleUserGithub({} as any, { type: "user_github", profile: "rcarmo" } as any);
  expect(networkError.message).toContain("Failed to fetch GitHub profile");

  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 404 }) as any;
  const httpError = await mod.handleUserGithub({} as any, { type: "user_github", profile: "rcarmo" } as any);
  expect(httpError.message).toContain("HTTP 404");
});

test("handleUserGithub stores profile on success for handle and URL", async () => {
  const mod = await setup();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        login: "rcarmo",
        name: "Rui Carmo",
        avatar_url: "https://avatars.example/rcarmo.png",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ) as any;

  const withAt = await mod.handleUserGithub({} as any, { type: "user_github", profile: "@rcarmo" } as any);
  expect(withAt.status).toBe("success");
  expect(withAt.message).toContain("Rui Carmo");

  const withName = await mod.handleUserGithub({} as any, { type: "user_github", profile: "rcarmo" } as any);
  expect(withName.status).toBe("success");
  expect(withName.message).toContain("Rui Carmo");

  const withUrl = await mod.handleUserGithub({} as any, {
    type: "user_github",
    profile: "https://www.github.com/rcarmo?tab=repositories",
  } as any);
  expect(withUrl.status).toBe("success");
  expect(withUrl.message).toContain("Rui Carmo");
});
