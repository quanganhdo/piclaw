import { renderAdaptiveCard } from "../../../web/src/ui/adaptive-card-renderer.js";
import { presentProviderAuth } from "../../../web/src/ui/provider-auth-presentation.js";

const container = document.querySelector<HTMLElement>("#card")!;
const status = document.querySelector<HTMLElement>("#status")!;
async function show(result: any) {
  status.textContent = result.message;
  container.replaceChildren();
  const block = result.contentBlocks?.[0];
  if (!block) return;
  await renderAdaptiveCard(container, block, { onAction: async action => {
    if (action.type !== "Action.Submit") return;
    const submit = async (payload: any, options: { signal?: AbortSignal } = {}) => {
      const response = await fetch("/fixture/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload.action.data), signal: options.signal });
      const result = await response.json();
      if (result.auth_presentation) return result;
      await show(result);
      return result;
    };
    presentProviderAuth(await submit({ action: { data: action.data } }), submit);
  } });
}
void fetch("/fixture/start").then(response => response.json()).then(show);
(window as any).showPrivateAuthFixture = (response: unknown) => presentProviderAuth(response, async () => ({ status: "ok" }));
(window as any).showPrivateAuthStalled = (response: unknown) => {
  (window as any).privateAuthAborted = false;
  return presentProviderAuth(response, async (_payload, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => { (window as any).privateAuthAborted = true; reject(new Error("aborted")); }, { once: true });
  }));
};
