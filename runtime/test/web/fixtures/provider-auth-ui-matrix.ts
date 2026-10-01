import { renderAdaptiveCard, type AdaptiveCardBlock } from "../../../web/src/ui/adaptive-card-renderer.js";
import { presentProviderAuth } from "../../../web/src/ui/provider-auth-presentation.js";

type FixtureState = {
  blocks: AdaptiveCardBlock[];
  message: string;
  model: string;
  postId: number;
  chatJid: string;
};
type SubmitOptions = { signal?: AbortSignal };

const card = document.querySelector<HTMLElement>("#card")!;
const status = document.querySelector<HTMLElement>("#status")!;
const model = document.querySelector<HTMLElement>("#model")!;
const start = document.querySelector<HTMLButtonElement>("#start")!;

async function request(url: string, init?: RequestInit): Promise<any> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    throw new Error("Request failed. Please try again.");
  }
}

async function submitAction(payload: unknown, options: SubmitOptions = {}): Promise<any> {
  const response = await request("/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  await refreshState();
  return response;
}

async function showState(state: FixtureState): Promise<void> {
  status.textContent = state.message;
  model.textContent = state.model;
  card.replaceChildren();
  for (const block of state.blocks) {
    const host = document.createElement("div");
    card.appendChild(host);
    await renderAdaptiveCard(host, block, { onAction: async action => {
      if (action.type !== "Action.Submit") return;
      const response = await submitAction({
        post_id: state.postId,
        chat_jid: state.chatJid,
        card_id: block.card_id,
        action: { type: action.type, title: action.title, data: action.data },
      });
      await refreshState();
      if (response.auth_presentation) presentProviderAuth(response, submitAction);
    } });
  }
}

async function refreshState(): Promise<void> {
  await showState(await request("/fixture/state"));
}

(window as any).fixtureReload = refreshState;
start.addEventListener("click", async () => {
  await request("/fixture/start", { method: "POST" });
  await refreshState();
});
void refreshState();
