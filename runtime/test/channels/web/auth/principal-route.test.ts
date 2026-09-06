import { expect, test } from "bun:test";
import { RequestRouterService } from "../../../../src/channels/web/request-router-service.js";
import { resolveRequestPrincipal } from "../../../../src/channels/web/auth/principal.js";

test("auth/me routes independently with security headers and no cookie disclosure", async () => {
  const principal=resolveRequestPrincipal(new Request("http://local"),{mode:"single-user",authEnabled:false},{getUser:()=>null,getSession:()=>null,getLocalDisplayName:()=>"Owner"});
  let resolved=0;
  const channel={authGateway:{getPrincipal:()=>{resolved++;return principal;}}};
  const router=new RequestRouterService(channel as any);
  const response=await router.handle(new Request("https://family.local/auth/me"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.has("x-request-id")).toBe(true);
  expect((await response.json()).principal.displayName).toBe("Owner");
  expect(resolved).toBe(1);
});

test("auth/me has a non-redirecting anonymous denial", async () => {
  const router=new RequestRouterService({authGateway:{getPrincipal:()=>null}} as any);
  const response=await router.handle(new Request("https://family.local/auth/me"));
  expect(response.status).toBe(401);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
