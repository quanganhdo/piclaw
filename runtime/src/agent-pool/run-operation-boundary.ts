import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { RunAgentOptions } from "./contracts.js";

/** Clamp every paid request, including tool-loop turns and SDK retries, to live host policy. */
export function createOperationModelBoundary(options: RunAgentOptions) {
  let release = () => {};
  return {
    apply(session: AgentSession): void {
      release();
      release = () => {};
      if (!options.requireToolCeiling) return;
      const agent = session.agent;
      if (!agent || typeof agent.streamFunction !== "function")
        throw new Error(
          "Restricted execution requires a model admission hook.",
        );
      const original = agent.streamFunction;
      const guarded: typeof original = async (
        model,
        context,
        streamOptions,
      ) => {
        // The SDK persisted/built this prompt before reaching the model stream.
        // Record that boundary even when policy/budget now pauses the request.
        options.onOperationInputCommitted?.();
        options.abortSignal?.throwIfAborted();
        streamOptions?.signal?.throwIfAborted();
        if (
          options.executionAdmissionCheck &&
          !(await options.executionAdmissionCheck())
        )
          throw new Error("Restricted execution permission revoked.");
        const blocked = await options.budgetBeforeModelCall?.(
          "operation_model_call",
          "",
          model.provider,
        );
        if (blocked) throw new Error("PICLAW-BUDGET-BLOCKED: " + blocked);
        options.abortSignal?.throwIfAborted();
        return original(model, context, streamOptions);
      };
      agent.streamFunction = guarded;
      release = () => {
        if (agent.streamFunction === guarded) agent.streamFunction = original;
      };
    },
    release() {
      release();
      release = () => {};
    },
  };
}
