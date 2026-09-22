import { html, render, useState } from "../../../web/src/vendor/preact-htm.js";
import { ComposeBox } from "../../../web/src/components/compose-box.js";

const OMIT = new URLSearchParams(location.search).get("agents") === "omitted";
const initialAgents = [
  { chat_jid: "web:default", agent_name: "fixture" },
  { chat_jid: "web:research", agent_name: "research" },
];
const services = { fetchCommands: async () => ({ commands: [] }) };
const capabilities = { speech: false, media: false, location: false, notifications: false, modelPicker: false, commands: false };
function Fixture() {
  const [agents, setAgents] = useState(initialAgents);
  const [mounted, setMounted] = useState(true);
  return html`<div>
    <button id="change-agents" onClick=${() => setAgents([{ chat_jid: "web:review", agent_name: "review" }, { chat_jid: "web:archived", agent_name: "retired", archived_at: "2026-01-01" }])}>Change agents</button>
    <button id="toggle-compose" onClick=${() => setMounted(value => !value)}>Toggle compose</button>
    ${mounted && html`<${ComposeBox} onPost=${() => {}} currentChatJid="web:default" services=${services} capabilities=${capabilities} ...${OMIT ? {} : { activeChatAgents: agents }} />`}
  </div>`;
}
render(html`<${Fixture} />`, document.getElementById("app")!);
