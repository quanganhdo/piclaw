import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, Model, ProviderHeaders } from "@earendil-works/pi-ai";

/** Canonical request auth needed only by direct provider-native HTTP helpers. */
export type ModelRequestAuth =
  | { ok: true; apiKey?: string; headers?: ProviderHeaders; env?: Record<string, string>; baseUrl?: string }
  | { ok: false; error: string };

/**
 * Resolve auth through the process-wide ModelRuntime for a direct HTTP request.
 * Normal model completions must call ModelRuntime.stream/streamSimple instead,
 * which keeps auth, provider environment, and credential-specific base URL
 * inside the canonical request assembly path.
 */
export async function resolveModelRequestAuth(
  modelRuntime: Pick<ModelRuntime, "getAuth">,
  model: Model<Api>,
): Promise<ModelRequestAuth> {
  if (!modelRuntime || typeof modelRuntime.getAuth !== "function") {
    return { ok: false, error: `No model runtime is available for ${model.provider}/${model.id}.` };
  }

  try {
    const resolved = await modelRuntime.getAuth(model);
    if (!resolved) return { ok: false, error: `No credentials available for ${model.provider}/${model.id}.` };
    return {
      ok: true,
      apiKey: resolved.auth.apiKey,
      headers: resolved.auth.headers,
      env: resolved.env,
      baseUrl: resolved.auth.baseUrl,
    };
  } catch {
    // Auth diagnostics can carry refresh tokens, headers or callback URLs.
    // Callers use this result in user-visible status and structured telemetry.
    return {
      ok: false,
      error: "Model credentials could not be resolved. Start provider login again.",
    };
  }
}
