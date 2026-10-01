import { openaiChatGPTOAuth } from "./auth/oauth/openai-chatgpt.js";
export function registerBunOAuthFlows() {
  if (openaiChatGPTOAuth.id !== "openai-chatgpt") throw new Error("transitive module missing");
}
