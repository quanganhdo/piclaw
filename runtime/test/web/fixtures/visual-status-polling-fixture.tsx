import { render } from "preact";
import { useState } from "preact/hooks";
import { ModelContextBar } from "../../../web/static/visual/frontend/src/components/ModelContextBar";
import { useStatusPolling } from "../../../web/static/visual/frontend/src/components/model-context-bar/useStatusPolling";

import {
  getAgentStatus,
  getAgentContext,
  getAgentModelState,
} from "../../../web/src/api";

const calls: Array<{ path: string; jid: string | null; aborted: boolean }> = [];
let blocked = false;
let statusCode = 200;
let model = "fixture/model";
let pending: Array<() => void> = [];
let overrides: Record<string,unknown> = {};
window.fetch = (async (input, init) => {
  const url = new URL(String(input), location.href);
  const record = {
    path: url.pathname,
    jid: url.searchParams.get("chat_jid"),
    aborted: false,
  };
  calls.push(record);
  init?.signal?.addEventListener("abort", () => {
    record.aborted = true;
  });
  const payload = {
    status: { status: "idle", data: null },
    model: {
      current: model,
      thinking_level: "medium",
      supports_thinking: true,
      model_options: [{ id: model, context_window: 200000 }],
      oobe: { provider_ready_completed_instance: true },
    },
    context: { tokens: 1234, percent: 0.617, contextWindow: 200000 },
    metrics: { cpu_percent: 2, ram_percent: 10 },
    agent_name: "Fixture",
    errors: [],
    ...structuredClone(overrides),
  };
  // Delayed body deliberately ignores abort to prove late continuations are
  // discarded by versions, not merely by the browser's fetch implementation.
  return {
    ok: statusCode === 200,
    json: () =>
      blocked
        ? new Promise((resolve) => pending.push(() => resolve(payload)))
        : Promise.resolve(payload),
  } as Response;
}) as typeof fetch;
function Owner({ mobile }: { mobile: boolean }) {
  const polling = useStatusPolling();
  return (
    <>
      <div id="desktop">
        <ModelContextBar polling={polling} />
      </div>
      {mobile && (
        <div id="mobile">
          <ModelContextBar polling={polling} />
        </div>
      )}
      <output id="status-state">
        {JSON.stringify({
          model: polling.currentModel.value,
          thinking: polling.currentThinkingLevel.value,
          tokens: polling.agentContext.value?.tokens,
          stale: polling.isStale.value,
        })}
      </output>
    </>
  );
}
function Fixture() {
  const [mounted, setMounted] = useState(true),
    [mobile, setMobile] = useState(true);
  Object.assign(window, {
    pollingFixture: {
      classicRefresh: () =>
        Promise.all([
          getAgentStatus("web:test"),
          getAgentContext("web:test"),
          getAgentModelState("web:test"),
        ]),
      setSnapshot: (value:Record<string,unknown>) => { overrides = value; },
      calls,
      clear: () => calls.splice(0),
      setMounted,
      setMobile,
      block: () => {
        blocked = true;
      },
      release: () => {
        blocked = false;
        const jobs = pending;
        pending = [];
        jobs.forEach((job) => job());
      },
      setStatusCode: (code: number) => {
        statusCode = code;
      },
      setModel: (value: string) => {
        model = value;
      },
    },
  });
  return mounted ? <Owner mobile={mobile} /> : <p>Unmounted</p>;
}
render(<Fixture />, document.getElementById("app")!);
