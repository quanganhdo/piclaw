import { expect, test } from "bun:test";
import { RequestRouterService } from "../../../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../../../src/channels/web/auth/auth-gateway.js";
import { TotpFailureTracker } from "../../../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../../../src/channels/web/auth/webauthn-challenges.js";
import { serveStatic } from "../../../../src/channels/web/http/static.js";

function router(passkeyOnly = false) {
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const authGateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: passkeyOnly ? "passkey-only" : "", totpSecret: "", internalSecret: "", sessionTtlSeconds: 3600, hasTls: true }, {
    json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker(),
    principalResolver: { getSession: () => null, getUser: () => null, getLocalDisplayName: () => "unused" },
  });
  return new RequestRouterService({ json, authGateway, serveStatic: (path: string, req?: Request) => serveStatic(path, () => json({ error: "Not found" }, 404), req) } as any, "family-shared");
}

test("family invitation shell and required bundle are public through the actual request guards", async () => {
  const app = router();
  const page = await app.handle(new Request("https://family.local/auth/invitation"));
  expect(page.status).toBe(200); expect(page.headers.get("cache-control")).toBe("private, no-store");
  expect(page.headers.get("referrer-policy")).toBe("no-referrer");
  const html = await page.text(); expect(html).toContain("Begin authenticator setup"); expect(html).not.toContain("__LOGIN_ASSET_VERSION__");
  const bundle = await app.handle(new Request("https://family.local/static/common/dist/invitation.bundle.js"));
  expect(bundle.status).toBe(200); expect(bundle.headers.get("location")).toBeNull();
  const head = await app.handle(new Request("https://family.local/auth/invitation", { method: "HEAD" }));
  expect(head.status).toBe(200); expect(await head.text()).toBe("");
  expect((await app.handle(new Request("https://family.local/static/common/dist/invitation.bundle.js.map"))).status).toBe(401);
  expect((await app.handle(new Request("https://family.local/auth/invitation", { method: "POST" }))).status).toBe(403);
  expect((await router(true).handle(new Request("https://family.local/auth/invitation"))).status).toBe(200);
});
