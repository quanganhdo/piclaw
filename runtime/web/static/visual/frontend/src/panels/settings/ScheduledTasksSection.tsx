import { useEffect, useState } from "preact/hooks";
import { registerSettingsPane } from "./pane-registry";

async function requestTasks(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

export function ScheduledTasksSection() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [budget, setBudget] = useState("");
  const selected = tasks.find((task) => task.id === selectedId) || tasks[0] || null;

  async function load(preferredId = selectedId) {
    setLoading(true);
    setError("");
    try {
      const payload = await requestTasks("/agent/scheduled-tasks?include_run_logs=1&run_log_limit=5");
      setTasks(payload.tasks || []);
      const next = payload.tasks?.find((task: any) => task.id === preferredId) || payload.tasks?.[0] || null;
      setSelectedId(next?.id || "");
      setBudget(next?.budget_usd == null ? "" : String(next.budget_usd));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => { setBudget(selected?.budget_usd == null ? "" : String(selected.budget_usd)); }, [selected?.id, selected?.budget_usd]);

  async function action(name: string, options: Record<string, unknown> = {}) {
    if (!selected || busy) return;
    const label = name === "set_budget" ? `${options.enabled === false ? "Disable" : "Update"} the per-run budget` : `${name} task`;
    if (!confirm(`${label} for ${selected.id}?`)) return;
    setBusy(true);
    setError("");
    try {
      await requestTasks("/agent/scheduled-tasks/action", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name, id: selected.id, ...options }),
      });
      await load(name === "delete" ? "" : selected.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  return <section className="settings-panel__section settings-panel__section--scheduled-tasks">
    <h2 className="settings-panel__section-title">Scheduled Tasks</h2>
    <p className="settings-panel__description">Manage task lifecycle and the optional API-equivalent USD cap applied independently to each scheduled agent run.</p>
    {loading && <p className="settings-panel__description" role="status">Loading scheduled tasks…</p>}
    {error && <div className="settings-panel__error" role="alert">{error} <button onClick={() => void load()}>Retry</button></div>}
    {!loading && tasks.length === 0 && <p className="settings-panel__description">No scheduled tasks found.</p>}
    {!loading && tasks.length > 0 && <div className="settings-panel__scheduled-layout">
      <div className="settings-panel__scheduled-list" role="listbox" aria-label="Scheduled tasks">{tasks.map((task) => <button className={task.id === selected?.id ? "is-active" : ""} role="option" aria-selected={task.id === selected?.id} onClick={() => setSelectedId(task.id)}><strong>{task.summary || task.id}</strong><span>{task.status} · {task.schedule_type}</span></button>)}</div>
      {selected && <article className="settings-panel__scheduled-detail">
        <header><div><h3>{selected.summary || selected.id}</h3><code>{selected.id}</code></div><span>{selected.status}</span></header>
        <dl><div><dt>Schedule</dt><dd>{selected.schedule_type} · {selected.schedule_value}</dd></div><div><dt>Next run</dt><dd>{selected.next_run || "—"}</dd></div><div><dt>Model</dt><dd>{selected.model || "default"}</dd></div><div><dt>Per-run budget</dt><dd>{selected.budget_usd == null ? "Uncapped" : `$${selected.budget_usd}`}{selected.budget_usd != null && !selected.budget_cap_enabled ? " · disabled" : ""}</dd></div></dl>
        {selected.task_kind === "agent" && <form className="settings-panel__scheduled-budget" onSubmit={(event) => { event.preventDefault(); void action("set_budget", { budget_usd: budget, enabled: true, ...(selected.budget_cap_revision ? { confirm_revision: selected.budget_cap_revision } : {}) }); }}>
          <label>Per-run API-equivalent USD<input required inputMode="decimal" value={budget} onInput={(event) => setBudget((event.target as HTMLInputElement).value)} /></label>
          <button disabled={busy}>{selected.budget_usd == null ? "Set budget" : "Update budget"}</button>
          {selected.budget_usd != null && selected.budget_cap_enabled && <button type="button" disabled={busy} onClick={() => void action("set_budget", { enabled: false, confirm_revision: selected.budget_cap_revision })}>Disable</button>}
        </form>}
        <p className="settings-panel__description">This cap is best-effort, is not a financial reservation, and remains the single source of truth for scheduled runs.</p>
        <div className="settings-panel__budget-actions">{selected.status === "active" && <button disabled={busy} onClick={() => void action("pause")}>Pause</button>}{selected.status === "paused" && <button disabled={busy} onClick={() => void action("resume")}>Resume</button>}<button disabled={busy} onClick={() => void action("delete", { allow_internal: selected.task_kind === "internal" })}>Delete</button></div>
      </article>}
    </div>}
  </section>;
}

registerSettingsPane({ id: "scheduled-tasks", label: "Scheduled Tasks", icon: <i className="codicon codicon-history" />, order: 65, component: () => <ScheduledTasksSection /> });
