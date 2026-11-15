import { expect, test } from "bun:test";
import { RequestRouterService } from "../../../../src/channels/web/request-router-service.js";
import { loginOptionsResponse } from "../../../../src/channels/web/auth/login-options.js";
import { parseLoginPolicy, buildTotpLoginBody } from "../../../../web/src/login-policy.js";

function gateway(enabled: boolean, totp: boolean, passkey: boolean) {
  return { isAuthEnabled: () => enabled, createTotpContext: () => ({ isTotpEnabled: () => totp }), createWebauthnContext: () => ({ isPasskeyEnabled: () => passkey }),
    getPrincipal: () => { throw Error("public policy must not read a principal"); } };
}

test("login method discovery exposes only non-secret policy and no principal/account inventory", async () => {
  for (const mode of ["single-user"] as const) {
    for (const [totp, passkey] of [[true,true], [true,false], [false,true]]) {
      const router = new RequestRouterService({ authGateway: gateway(true, totp!, passkey!) } as any, mode);
      const response = await router.handle(new Request("https://family.local/auth/options"));
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      const policy = await response.json();
      expect(Object.keys(policy).sort()).toEqual(["auth_enabled", "mode", "passkey", "totp", "username_required"]);
      expect(parseLoginPolicy(policy).username_required).toBe(false);
    }
  }
});

test("options HEAD/method restrictions and unsupported isolated policy", async () => {
  const req = (method: string) => new Request("https://family.local/auth/options", { method });
  expect(await loginOptionsResponse(req("HEAD"), "single-user", gateway(true, true, true)).text()).toBe("");
  expect(loginOptionsResponse(req("POST"), "single-user", gateway(true, true, true)).status).toBe(405);
  expect(loginOptionsResponse(req("GET"), "isolated-containers", gateway(true, true, true)).status).toBe(503);
  const none = await loginOptionsResponse(req("GET"), "single-user", gateway(false, true, true)).json();
  expect(none).toMatchObject({ auth_enabled: false, totp: false, passkey: false });
  expect(parseLoginPolicy(none).auth_enabled).toBe(false);
});

test("client policy rejects unsupported modes and inconsistent fields", () => {
  const valid = { mode: "single-user", auth_enabled: true, totp: true, passkey: true, username_required: false };
  for (const invalid of [null, {}, { ...valid, mode: "family-shared" }, { ...valid, mode: "isolated-containers" }, { ...valid, username_required: true }, { ...valid, auth_enabled: false }, { ...valid, totp: false, passkey: false }, { ...valid, passkey: "true" }]) expect(() => parseLoginPolicy(invalid)).toThrow();
  const policy = parseLoginPolicy(valid);
  expect(buildTotpLoginBody(policy, " 123456 ")).toEqual({ code: "123456" });
  expect(() => buildTotpLoginBody(policy, "12345")).toThrow("six-digit");
  expect(() => buildTotpLoginBody({ ...policy, totp: false }, "123456")).toThrow("unavailable");
});
