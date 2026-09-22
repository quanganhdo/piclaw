import {
  html,
  render,
  useState,
  useRef,
} from "../../../web/src/vendor/preact-htm";
import { useChatRefreshLifecycle } from "../../../web/src/ui/app-chat-refresh-lifecycle";
import { ComposeBox } from "../../../web/src/components/compose-box";
import { resetAppRefreshCoordination } from "../../../web/src/ui/app-refresh-coordination";
let model: any = {
  current: "fixture/model",
  thinking_level: "high",
  thinking_level_label: "High",
  supports_thinking: true,
  available_model_count: 1,
  model_options: [{ id: "fixture/model", context_window: 200000 }],
};
let context: any = {
  tokens: 1234,
  percent: 0.617,
  contextWindow: 200000,
  sessionGeneration: "one",
};
let failed = false,
  blocked = false;
const pending: Array<() => void> = [];
const noop = () => {},
  empty = async () => ({});
let calls = 0;
window.fetch = (async () => Response.json({})) as typeof fetch;
function Fixture() {
  const [chat, setChat] = useState("web:a"),
    [active, setActive] = useState(null),
    [thinking, setThinking] = useState(null),
    [supports, setSupports] = useState(false),
    [_usage, setUsage] = useState(null),
    [payload, setPayload] = useState(null),
    [loaded, setLoaded] = useState(false),
    [ctx, setCtx] = useState(null),
    [tick, setTick] = useState(0);
  const activeRef = useRef(chat);
  activeRef.current = chat;
  const shell = useRef(null),
    width = useRef(300),
    agents = useRef({});
  const lifecycle = useChatRefreshLifecycle({
    currentChatJid: chat,
    currentRootChatJid: chat,
    activeChatJidRef: activeRef,
    getAgents: empty,
    setAgents: noop,
    setUserProfile: noop,
    applyBranding: noop,
    readStoredNumber: () => null,
    sidebarWidthRef: width,
    appShellRef: shell,
    // Deliberately fresh callback references test same-chat rerender resilience.
    getAgentModels: async () => {
      calls++;
      if (failed) throw Error("fixture unavailable");
      const value = structuredClone(model);
      if (blocked) await new Promise<void>((r) => pending.push(r));
      return value;
    },
    getAgentContext: async () => structuredClone(context),
    getActiveChatAgents: empty,
    getChatBranches: empty,
    setActiveChatAgents: noop,
    setCurrentChatBranches: noop,
    setActiveModel: setActive,
    setActiveThinkingLevel: setThinking,
    setSupportsThinking: setSupports,
    setActiveModelUsage: setUsage,
    setAgentModelsPayload: setPayload,
    setHasLoadedAgentModels: setLoaded,
    agentsRef: agents,
    refreshQueueState: noop,
    refreshContextUsage: async () => {},
    refreshAutoresearchStatus: async () => {},
    setContextUsage: setCtx,
    setExtensionWorkingState: noop,
  });
  Object.assign(window, {
    classicFixture: {
      refresh: () => {
        resetAppRefreshCoordination();
        return lifecycle.refreshModelState();
      },
      apply: lifecycle.applyModelState,
      changeChat: setChat,
      rerender: () => setTick(tick + 1),
      setModel: (x: any) => {
        model = x;
      },
      setContext: (x: any) => {
        context = x;
      },
      fail: (x: boolean) => {
        failed = x;
      },
      block: () => {
        blocked = true;
      },
      release: () => {
        blocked = false;
        pending.splice(0).forEach((r) => r());
      },
      calls: () => calls,
    },
  });
  return html`<output id="classic-state"
      >${JSON.stringify({ chat, model: active, thinking, supports, loaded, context: ctx, tick })}</output
    ><${ComposeBox}
      currentChatJid=${chat}
      activeModel=${active}
      thinkingLevel=${thinking}
      supportsThinking=${supports}
      agentModelsPayload=${payload}
      contextUsage=${ctx}
      onContextCompact=${noop}
      activeChatAgents=${[]}
      capabilities=${{ speech: false, attachmentButton: false, cameraButton: false, locationButton: false, notifications: false, modelPicker: true, commandReference: false }}
      onSubmit=${async () => true}
    />`;
}
render(html`<${Fixture} />`, document.getElementById("app")!);
