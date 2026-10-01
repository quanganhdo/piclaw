type SubmitAction = (payload: any, options?: { signal?: AbortSignal }) => Promise<any>;
type UnknownRecord = Record<string, unknown>;

let dismissActive: (() => void) | null = null;
const isRecord = (value: unknown): value is UnknownRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown, limit = 2000): string => typeof value === "string" ? value.slice(0, limit) : "";

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 4096) return null;
  const raw = value;
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function addText(parent: HTMLElement, value: unknown, strong = false): void {
  const text = bounded(value);
  if (!text) return;
  const node = document.createElement(strong ? "strong" : "p");
  node.textContent = text;
  node.style.margin = "0";
  node.style.overflowWrap = "anywhere";
  parent.appendChild(node);
}

function addLink(parent: HTMLElement, value: unknown, label: unknown): void {
  const url = safeUrl(value);
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = bounded(label, 300) || "Open authentication page";
  parent.appendChild(link);
}

function renderEvent(parent: HTMLElement, value: unknown): void {
  if (!isRecord(value)) return;
  const section = document.createElement("section");
  Object.assign(section.style, { display: "grid", gap: "0.45rem", padding: "0.75rem", border: "1px solid var(--border-color, #555)", borderRadius: "0.5rem" });
  if (value.type === "auth_url") {
    addText(section, bounded(value.instructions) || "Open the login page and complete authentication.");
    addLink(section, value.url, "Open login page ↗");
  } else if (value.type === "device_code") {
    addText(section, "Open the verification page and enter this code:");
    addText(section, bounded(value.userCode, 256), true);
    addLink(section, value.verificationUri, "Open verification page ↗");
    const interval = Number(value.intervalSeconds), expires = Number(value.expiresInSeconds);
    if (Number.isFinite(interval) && interval > 0) addText(section, `Check interval: ${Math.min(interval, 86400)} seconds`);
    if (Number.isFinite(expires) && expires > 0) addText(section, `Code expires in ${Math.min(expires, 86400)} seconds`);
  } else if (value.type === "info") {
    addText(section, value.message);
    if (Array.isArray(value.links)) for (const item of value.links.slice(0, 12)) {
      if (isRecord(item)) addLink(section, item.url, item.label || "Open link ↗");
    }
  } else if (value.type === "progress") addText(section, value.message);
  else return;
  if (section.childNodes.length) parent.appendChild(section);
}

/** Present provider-owned authentication data transiently in the current page. */
export function presentProviderAuth(response: unknown, submit: SubmitAction): boolean {
  if (!isRecord(response) || response.status !== "ok" || !isRecord(response.auth_presentation) || typeof submit !== "function") return false;
  const presentation = response.auth_presentation;
  const expiresAt = presentation.expires_at;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || !Array.isArray(presentation.events) || !isRecord(presentation.action_data)) return false;
  if (typeof response.source_post_id !== "number" || !Number.isInteger(response.source_post_id) || response.source_post_id <= 0 || typeof response.card_id !== "string" || response.card_id.length > 4096 || typeof response.chat_jid !== "string" || response.chat_jid.length > 4096) return false;
  const promptValue = presentation.prompt;
  if (promptValue !== null && (!isRecord(promptValue) || !["secret", "text", "manual_code", "select"].includes(String(promptValue.type)))) return false;
  const entries = Object.entries(presentation.action_data);
  if (entries.length > 64 || entries.some(([key, value]) => key.length > 128 || typeof value !== "string" || value.length > 4096)) return false;
  dismissActive?.();
  if (Date.now() >= expiresAt) return true;

  let actionData: Record<string, string> = Object.fromEntries(entries) as Record<string, string>;
  let postId = response.source_post_id, cardId = response.card_id, chatJid = response.chat_jid;
  const prompt = isRecord(promptValue) ? {
    type: String(promptValue.type), message: bounded(promptValue.message, 1000), placeholder: bounded(promptValue.placeholder, 500),
    options: (Array.isArray(promptValue.options) ? promptValue.options.slice(0, 64) : []).flatMap((option) =>
      isRecord(option) && typeof option.id === "string" && option.id.length <= 4096
        ? [{ id: option.id, label: bounded(option.label, 500), description: bounded(option.description, 1000) }] : []),
  } : null;
  const dialog = document.createElement("dialog");
  Object.assign(dialog.style, { width: "min(38rem, calc(100vw - 2rem))", maxWidth: "38rem", maxHeight: "min(80vh, 48rem)", padding: "0", color: "var(--text-primary, #eee)", background: "var(--sidebarBg, var(--background-color, #222))", border: "1px solid var(--border-color, #555)", borderRadius: "0.75rem", boxShadow: "0 1rem 3rem rgba(0,0,0,.45)" });
  const panel = document.createElement("form");
  Object.assign(panel.style, { display: "grid", gap: "0.85rem", padding: "1rem", overflow: "auto" });
  const heading = document.createElement("strong");
  heading.textContent = "Provider authentication";
  heading.style.fontSize = "1.1rem";
  panel.appendChild(heading);
  for (const event of presentation.events.slice(0, 16)) renderEvent(panel, event);

  let input: HTMLInputElement | HTMLSelectElement | null = null;
  if (prompt) {
    const label = document.createElement("label");
    label.textContent = bounded(prompt.message, 1000) || "Authentication value";
    label.style.display = "grid";
    label.style.gap = "0.4rem";
    if (prompt.type === "select") {
      const select = document.createElement("select");
      for (const option of prompt.options) {
        const element = document.createElement("option");
        element.value = option.id;
        element.textContent = [bounded(option.label, 500), bounded(option.description, 1000)].filter(Boolean).join(" — ");
        select.appendChild(element);
      }
      input = select;
    } else {
      const field = document.createElement("input");
      field.type = prompt.type === "secret" ? "password" : "text";
      field.placeholder = bounded(prompt.placeholder, 500);
      field.autocomplete = prompt.type === "manual_code" ? "one-time-code" : "off";
      input = field;
    }
    Object.assign(input.style, { padding: "0.6rem", color: "inherit", background: "var(--bg-primary, #111)", border: "1px solid var(--border-color, #555)", borderRadius: "0.4rem" });
    label.appendChild(input);
    panel.appendChild(label);
  }

  const status = document.createElement("p");
  status.setAttribute("role", "alert");
  status.style.margin = "0";
  const buttons = document.createElement("div");
  Object.assign(buttons.style, { display: "flex", gap: "0.6rem", flexWrap: "wrap" });
  const makeButton = (label: string) => { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.style.padding = "0.55rem 0.8rem"; return button; };
  const continueButton = makeButton(prompt ? "Continue" : "Check & Continue");
  const cancelButton = makeButton("Cancel authentication");
  const closeButton = makeButton("Close");
  buttons.append(continueButton, cancelButton, closeButton);
  panel.append(status, buttons);
  dialog.appendChild(panel);
  document.body.appendChild(dialog);

  let timer = 0, destroyed = false, running = false;
  const controller = new AbortController();
  let pendingData: Record<string, unknown> | null = null;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    controller.abort();
    if (pendingData) delete pendingData.auth_value;
    window.clearTimeout(timer);
    window.removeEventListener("pagehide", destroy);
    dialog.querySelectorAll("button,input,select").forEach((control) => { (control as HTMLButtonElement).disabled = true; });
    if (input) { input.value = ""; if (input instanceof HTMLSelectElement) input.replaceChildren(); }
    if (dialog.open) dialog.close();
    dialog.replaceChildren();
    dialog.remove();
    actionData = {}; postId = 0; cardId = ""; chatJid = "";
    if (dismissActive === destroy) dismissActive = null;
  };
  const expire = () => {
    if (Date.now() >= expiresAt) destroy();
    else timer = window.setTimeout(expire, Math.min(expiresAt - Date.now() + 25, 2_147_483_647));
  };
  dialog.addEventListener("click", (event) => {
    if (Date.now() >= expiresAt) { event.preventDefault(); destroy(); }
  }, true);
  window.addEventListener("pagehide", destroy, { once: true });
  const setBusy = (busy: boolean) => { continueButton.disabled = busy; cancelButton.disabled = busy; if (input) input.disabled = busy; };
  const run = async (method: "runtime_continue" | "runtime_check" | "runtime_cancel") => {
    if (running || Date.now() >= expiresAt) { if (Date.now() >= expiresAt) destroy(); return; }
    running = true; setBusy(true); status.textContent = "";
    const data = method === "runtime_cancel" ? { ...actionData, method } : { ...actionData, method, auth_value: input?.value ?? "" };
    pendingData = data;
    try {
      const next = await submit({ post_id: postId, card_id: cardId, chat_jid: chatJid, action: { type: "Action.Submit", title: "Authentication action", data } }, { signal: controller.signal });
      if (destroyed) return;
      destroy();
      presentProviderAuth(next, submit);
    } catch {
      if (!destroyed) { running = false; status.textContent = "Authentication action failed. Please try again."; setBusy(false); }
    } finally {
      delete (data as Record<string, unknown>).auth_value;
      pendingData = null;
    }
  };
  panel.addEventListener("submit", (event) => { event.preventDefault(); void run(prompt ? "runtime_continue" : "runtime_check"); });
  continueButton.addEventListener("click", () => void run(prompt ? "runtime_continue" : "runtime_check"));
  cancelButton.addEventListener("click", () => void run("runtime_cancel"));
  closeButton.addEventListener("click", destroy);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); destroy(); });
  dismissActive = destroy;
  timer = window.setTimeout(expire, Math.min(Math.max(0, expiresAt - Date.now()) + 25, 2_147_483_647));
  dialog.showModal();
  input?.focus();
  return true;
}
