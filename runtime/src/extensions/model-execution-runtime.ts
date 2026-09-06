import type { Api, Model, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { sanitizeProviderPayloadItemIds } from "./provider-request-sanitizer.js";
import { recordProviderResponseDiagnostics } from "./provider-response-diagnostics.js";
import { createLogger } from "../utils/logger.js";
import { readAccessConfig } from "../core/config-access.js";
import { getExecutionIdentity } from "../core/execution-context.js";

const log = createLogger("extensions.model-execution-runtime");

export type RuntimeModelExecutor = Pick<ModelRuntime, "streamSimple" | "completeSimple">;

let runtimeModelExecutor: RuntimeModelExecutor | null = null;

/** This direct path has no owner-aware admission or model identity contract yet. */
function requireSingleUserExecution(): void {
  const mode = readAccessConfig().mode;
  const identity = getExecutionIdentity();
  if (mode !== "single-user" || (identity && identity.mode !== "single-user")) {
    throw new Error("Direct model execution is unavailable in multi-user mode.");
  }
}

function composeOptions(model: Model<Api>, options: ModelsSimpleStreamOptions = {}): ModelsSimpleStreamOptions {
  const callerPayload = options.onPayload;
  const callerResponse = options.onResponse;
  return {
    ...options,
    onPayload: async (payload, selectedModel) => {
      const effectiveModel = selectedModel ?? model;
      const transformed = callerPayload ? await callerPayload(payload, effectiveModel) : undefined;
      return sanitizeProviderPayloadItemIds(transformed ?? payload, {
        stripConnectionBoundIds: effectiveModel.provider === "github-copilot" && effectiveModel.api === "openai-responses",
        onOrphanFunctionCallOutputs: (diagnostic) => {
          log.warn("Removed orphan OpenAI Responses function-call outputs before bundled model execution", {
            operation: "model_execution_runtime.orphan_function_call_outputs",
            removedCount: diagnostic.removedCount,
            callIds: diagnostic.callIds,
            provider: effectiveModel.provider,
            modelId: effectiveModel.id,
            api: effectiveModel.api,
          });
        },
      });
    },
    onResponse: async (response, selectedModel) => {
      recordProviderResponseDiagnostics(response.status, response.headers);
      await callerResponse?.(response, selectedModel);
    },
  };
}

/** Install the process-wide runtime-owned executor used by bundled path extensions. */
export function installRuntimeModelExecutor(modelRuntime: ModelRuntime): void {
  if (runtimeModelExecutor) throw new Error("Runtime model executor is already installed");
  runtimeModelExecutor = {
    streamSimple: (model, context, options) => {
      requireSingleUserExecution();
      return modelRuntime.streamSimple(model, context, composeOptions(model, options));
    },
    completeSimple: (model, context, options) => {
      requireSingleUserExecution();
      return modelRuntime.completeSimple(model, context, composeOptions(model, options));
    },
  };
}

export function getRuntimeModelExecutor(): RuntimeModelExecutor | null {
  return runtimeModelExecutor;
}

export function __setRuntimeModelExecutorForTests(executor: RuntimeModelExecutor | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Runtime model executor test override is test-only");
  runtimeModelExecutor = executor;
}
