#!/usr/bin/env bun

import { streamSimple } from "@earendil-works/pi-ai/api/bedrock-converse-stream";
import { providerTranscriptContext } from "../src/extensions/transcript-context-compat.js";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

import { getAvailableThinkingLevelsForModel } from "../src/agent-control/agent-control-helpers.js";

const args = new Set(process.argv.slice(2));
const live = args.has("--live");
const modelArg = process.argv.find((value) => value.startsWith("--model="))?.slice("--model=".length)
  ?? (process.env.PI_PROVIDER === "amazon-bedrock" ? process.env.PI_MODEL : undefined)
  ?? "us.anthropic.claude-opus-5";
const model = getBuiltinModels("amazon-bedrock").find((candidate) => candidate.id === modelArg);

if (!model) {
  console.error(`Unknown Amazon Bedrock model: ${modelArg}`);
  process.exit(2);
}

const thinkingLevels = getAvailableThinkingLevelsForModel(model);
const capability = {
  label: `${model.provider}/${model.id}`,
  provider: model.provider,
  id: model.id,
  name: model.name,
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
  reasoning: Boolean(model.reasoning),
  thinkingLevels,
  nativeXhigh: model.thinkingLevelMap?.xhigh === "xhigh",
};
if (!live) {
  console.log(JSON.stringify({
    mode: "dry-run",
    network: false,
    model: capability,
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? null,
    profile: process.env.AWS_PROFILE ?? null,
    authSourcesPresent: {
      bearerToken: Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK),
      accessKeys: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
      ecsTaskRole: Boolean(process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI),
      webIdentity: Boolean(process.env.AWS_WEB_IDENTITY_TOKEN_FILE),
      profile: Boolean(process.env.AWS_PROFILE),
    },
  }, null, 2));
  process.exit(0);
}

const startedAt = Date.now();
const stream = streamSimple(model, providerTranscriptContext({
  messages: [{ role: "user", content: "Reply with exactly: BEDROCK_OK", timestamp: Date.now() }],
}), {
  maxTokens: 64,
  reasoning: "minimal",
});
const result = await stream.result();
console.log(JSON.stringify({
  mode: "live",
  network: true,
  model: capability.label,
  stopReason: result.stopReason,
  text: result.content.filter((block) => block.type === "text").map((block) => block.text).join(""),
  usage: result.usage,
  elapsedMs: Date.now() - startedAt,
}, null, 2));
