import { useEffect, useRef, useState } from "preact/hooks";
import { getChatJid } from "../../api/chat-jid";
import { registerSettingsPane } from "./pane-registry";
import {
  BUDGET_METRIC_LABELS,
  BUDGET_SCOPE_LABELS,
  budgetEvidenceState,
  buildBudgetSaveRequest,
  capToBudgetDraft,
  defaultBudgetCapDraft,
  formatBudgetAmount,
  formatBudgetDate,
  normalizeBudgetCapDraft,
} from "../../../../../../src/ui/budget-settings-model";

type BudgetPayload = Record<string, any>;

async function requestBudget(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

export function BudgetSection() {
  const [payload, setPayload] = useState<BudgetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<any>(() => defaultBudgetCapDraft());
  const [showForm, setShowForm] = useState(false);
  const [allowance, setAllowance] = useState({ cap_id: "", amount: "", expires_at: "" });
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const chatJid = getChatJid();

  async function load() {
    setLoading(true);
    setError("");
    try {
      const next = await requestBudget(`/agent/settings/budget?chat_jid=${encodeURIComponent(chatJid)}`);
      setPayload(next);
      setDraft((current: any) => current.id ? current : defaultBudgetCapDraft(next));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => { if (showForm) headingRef.current?.focus(); }, [showForm]);

  async function mutate(body: Record<string, unknown>, success: string) {
    if (busy) return null;
    setBusy(true);
    setError("");
    try {
      const next = await requestBudget(`/agent/settings/budget/action?chat_jid=${encodeURIComponent(chatJid)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      setPayload(next);
      return { next, success };
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setDraft(defaultBudgetCapDraft(payload || {}));
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setDraft(defaultBudgetCapDraft(payload || {}));
    requestAnimationFrame(() => createButtonRef.current?.focus());
  }

  async function saveCap(event: Event) {
    event.preventDefault();
    let body: Record<string, unknown>;
    try { body = buildBudgetSaveRequest(draft, payload || {}); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); return; }
    if (draft.confirm_revision && !confirm(`Update ${draft.id} revision ${draft.confirm_revision}? Existing spend and audit history will remain.`)) return;
    if (await mutate(body, draft.id ? `Updated ${draft.id}.` : "Budget cap created.")) closeForm();
  }

  async function toggleCap(cap: any) {
    const verb = cap.enabled ? "Disable" : "Enable";
    if (!confirm(`${verb} ${cap.id}? Existing spend and audit history will remain.`)) return;
    await mutate({ action: "set_cap_enabled", id: cap.id, enabled: !cap.enabled, confirm_revision: cap.revision }, `${verb}d ${cap.id}.`);
  }

  const work = payload?.work;
  const blockers = payload?.decision?.blockers || [];

  return (
    <section className="settings-panel__section settings-panel__section--budget">
      <header className="settings-panel__budget-header">
        <div><h2 className="settings-panel__section-title">Budget</h2><p className="settings-panel__description">{payload?.pricing_notice || "API-equivalent USD is an estimate, not an invoice or subscription balance."}</p></div>
        <button ref={createButtonRef} className="settings-panel__button" disabled={busy || loading} onClick={openCreate}>Create cap</button>
      </header>
      <p className="settings-panel__description">{payload?.reservation_notice || "Budget limits v1 does not reserve spend and never selects a cheaper model automatically."}</p>
      <p className="settings-panel__description"><strong>Enforcement:</strong> {payload?.enforcement === "best_effort_boundaries" ? "Best effort at boundaries Piclaw controls." : "Unknown."}</p>
      {loading && <p className="settings-panel__description" role="status">Loading budget policy…</p>}
      {error && <div className="settings-panel__error" role="alert">{error} <button onClick={() => void load()}>Retry</button></div>}

      {showForm && <form className="settings-panel__budget-form" onSubmit={saveCap}>
        <h3 ref={headingRef} tabIndex={-1}>{draft.id ? `Edit ${draft.id}` : "Create budget cap"}</h3>
        <label className="settings-panel__label">Scope<select className="settings-panel__input" value={draft.scope} onChange={(event) => setDraft(normalizeBudgetCapDraft({ ...draft, scope: (event.target as HTMLSelectElement).value }, payload || {}))}>
          {work && <option value="task">Current work</option>}<option value="instance_daily">Daily instance</option><option value="instance_monthly">Monthly instance</option><option value="provider_window">Provider guard</option>
        </select></label>
        <label className="settings-panel__label">Amount<input required className="settings-panel__input" inputMode="decimal" value={draft.amount} onInput={(event) => setDraft({ ...draft, amount: (event.target as HTMLInputElement).value })} /></label>
        {(draft.scope === "instance_daily" || draft.scope === "instance_monthly") && <label className="settings-panel__label">Timezone<input required className="settings-panel__input" value={draft.timezone} onInput={(event) => setDraft({ ...draft, timezone: (event.target as HTMLInputElement).value })} /></label>}
        {draft.scope === "provider_window" && <>
          <label className="settings-panel__label">Provider<select className="settings-panel__input" value={draft.provider_id} onChange={(event) => setDraft(normalizeBudgetCapDraft({ ...draft, provider_id: (event.target as HTMLSelectElement).value }, payload || {}))}>{(payload?.provider_capabilities || []).map((item: any) => <option value={item.provider_id}>{item.provider_id}</option>)}</select></label>
          <label className="settings-panel__label">Quota dimension<select className="settings-panel__input" value={draft.quota_dimension} onChange={(event) => setDraft(normalizeBudgetCapDraft({ ...draft, quota_dimension: (event.target as HTMLSelectElement).value }, payload || {}))}>{(payload?.provider_capabilities || []).find((item: any) => item.provider_id === draft.provider_id)?.dimensions?.map((value: string) => <option value={value}>{value}</option>)}</select></label>
        </>}
        <p className="settings-panel__description">Metric: {(BUDGET_METRIC_LABELS as any)[normalizeBudgetCapDraft(draft, payload || {}).metric]}. Credential binding stays server-side.</p>
        <div className="settings-panel__budget-actions"><button type="button" onClick={closeForm}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving…" : draft.id ? "Confirm update" : "Create cap"}</button></div>
      </form>}

      {!loading && !showForm && <>
        <h3 className="settings-panel__subsection-title">Policy</h3>
        {(payload?.caps || []).length === 0 ? <p className="settings-panel__description">No limits configured. Piclaw remains uncapped.</p> : <div className="settings-panel__budget-grid">{payload?.caps.map((cap: any) => {
          const evidence = budgetEvidenceState(cap);
          return <article className={`settings-panel__budget-card${cap.enabled ? "" : " is-disabled"}`}>
            <header><div><strong>{cap.id}</strong><span>{(BUDGET_SCOPE_LABELS as any)[cap.scope]} · {(BUDGET_METRIC_LABELS as any)[cap.metric]}</span></div><span>{cap.enabled ? "Enabled" : "Disabled"}</span></header>
            <dl><div><dt>Limit</dt><dd>{formatBudgetAmount(cap.amount, cap.metric)}</dd></div><div><dt>Used/value</dt><dd>{cap.known_usage == null ? "Unknown" : formatBudgetAmount(cap.known_usage, cap.metric)}</dd></div><div><dt>Remaining</dt><dd>{cap.remaining == null ? "Unknown" : formatBudgetAmount(cap.remaining, cap.metric)}</dd></div><div><dt>Reset</dt><dd>{formatBudgetDate(cap.window?.ends_at)}</dd></div></dl>
            <p className="settings-panel__description">revision {cap.revision}{evidence ? ` · ${evidence.label}` : ""}</p>
            <div className="settings-panel__budget-actions"><button onClick={() => { setDraft(capToBudgetDraft(cap, payload || {})); setShowForm(true); }}>Edit</button><button disabled={busy} onClick={() => void toggleCap(cap)}>{cap.enabled ? "Disable" : "Enable"}</button></div>
          </article>;
        })}</div>}

        <h3 className="settings-panel__subsection-title">Current work</h3>
        {!work ? <p className="settings-panel__description">No active or paused work is bound to this chat.</p> : <div className="settings-panel__budget-work">
          <strong>{work.id}</strong><p>{work.execution_kind} · {work.status} · last boundary {work.last_boundary || "—"}</p>
          {payload?.override && <p>Warnings-only until {formatBudgetDate(payload.override.expires_at)}</p>}
          {work.status === "paused" && <form className="settings-panel__budget-allowance" onSubmit={async (event) => { event.preventDefault(); await mutate({ action: "grant_allowance", work_id: work.id, cap_id: allowance.cap_id, amount: allowance.amount, ...(allowance.expires_at ? { expires_at: new Date(allowance.expires_at).toISOString() } : {}) }, "Allowance granted. Send a continuation message to resume."); }}>
            <label>Blocking cap<select required value={allowance.cap_id} onChange={(event) => setAllowance({ ...allowance, cap_id: (event.target as HTMLSelectElement).value })}><option value="">Select…</option>{blockers.map((item: any) => <option value={item.capId}>{item.capId}</option>)}</select></label>
            <label>Extra amount<input required inputMode="decimal" value={allowance.amount} onInput={(event) => setAllowance({ ...allowance, amount: (event.target as HTMLInputElement).value })} /></label>
            <label>Expiry (optional)<input type="datetime-local" value={allowance.expires_at} onInput={(event) => setAllowance({ ...allowance, expires_at: (event.target as HTMLInputElement).value })} /></label>
            <button disabled={busy}>Grant and resume</button>
          </form>}
          <div className="settings-panel__budget-actions"><button disabled={busy} onClick={() => confirm("Use warnings-only for one hour?") && void mutate({ action: "warnings_only", work_id: work.id }, "Warnings-only enabled. Send a continuation message to resume.")}>Warnings-only 1h</button>{work.status === "paused" && <button disabled={busy} onClick={() => confirm("Resume without changing any cap?") && void mutate({ action: "resume_work", work_id: work.id }, "Work is ready. Send a continuation message to resume.")}>Resume</button>}<button disabled={busy} onClick={() => confirm(`Cancel ${work.id}?`) && void mutate({ action: "cancel_work", work_id: work.id }, `Cancelled ${work.id}.`)}>Cancel</button></div>
        </div>}

        <h3 className="settings-panel__subsection-title">Scheduled runs</h3>
        <p className="settings-panel__description">Per-run <code>budget_usd</code> remains in Scheduled Tasks so there is one source of truth.</p>
        <button className="settings-panel__button" onClick={() => window.dispatchEvent(new CustomEvent("piclaw:open-settings", { detail: { section: payload?.scheduled_task_settings_section || "scheduled-tasks" } }))}>Open Scheduled Tasks</button>
      </>}
    </section>
  );
}

registerSettingsPane({ id: "budget", label: "Budget", icon: <i className="codicon codicon-dashboard" />, order: 22, component: () => <BudgetSection /> });
