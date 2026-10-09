import {expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'../../..');
const hashes={
  "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-101-packaged-cli-auth-bun.json": "3da8fcaeaf2e354aafba5ed5c545e4944ff961d36e8d93977d70c9c7dd518d8c",
  "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-101-codex-device-bun.json": "c769a6ad77d7bc147b94463022fb4de2a940b1a67fcaf5efb5b605e3dec85cfe",
  "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-101-registry.json": "3755d347c217afbec87e20320f0e7d93e33416fc5715191436bb9ad4b29b62b2",
  "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-101-provider-auth.json": "b56b0bdd98ebbdca8c178e922b85a00601c4c6e966df430a22fa34f99adb5f16",
  "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-101-package-admission.json": "25a7840517701999a4360fd75061633269bf250db64186d52d75eb603cc8983e",
  "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-101-anthropic-private-ui.json": "b793c38b1bc506a6f1f6c72b29d0245139c45c0f76413616b6634283ccc572a8",
  "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-101-provider-devices-bun.json": "94cea9b5a54903c7ef2d3533e4b2072d445f66e6460e1500ad8186a35c066103",
  "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-101-mcp-public.json": "33feeee57ff021510d9904f2a2709fe0fb2c15b9b3d303ff2355e32f43f24f8a",
  "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-101-provider-browser-bun.json": "c2fc27833d331e43ac7509663380496c34329f0243f8af3bb8668cdd5f84fee6",
  "runtime/test/fixtures/earendil-package-admission/registry-1.0.1.json": "4fcdfb847adf09d5a094d7bbdb78ea2187fc277490c0fe8ec4132d36823d7218",
  "runtime/test/fixtures/earendil-package-admission/cli-artifact-1.0.1.json": "5c57536ef7a2ec2580fb4e581c38f709dd9d70a90e052df523e3f8c552cf6ea3"
};
test('Pi 1.0.2 migration preserves immutable 1.0.1 artifacts and receipts',()=>{for(const[path,expected]of Object.entries(hashes))expect(createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex'),path).toBe(expected);});
