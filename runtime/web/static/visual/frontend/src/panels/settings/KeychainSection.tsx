import { useCallback, useEffect, useRef, useId } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { useDialog } from "../../hooks/useDialog";
import { registerSettingsPane } from "./pane-registry";
import { CustomSelect } from "../../components/CustomSelect";

import { createLogger } from "../../utils/logger";
const log = createLogger("keychain");


interface KeychainEntry {
  name: string;
  type?: string;
  envVar?: string | null;
  updatedAt?: string;
}

interface KeychainResponse {
  entries?: KeychainEntry[];
}

export function KeychainSection() {
  const prefix = useId();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef(false);
  const saving = useSignal(false);
  const announcement = useSignal('');
  const entries = useSignal<KeychainEntry[]>([]);
  const filter = useSignal("");
  const showAdd = useSignal(false);
  const finishAdd = () => { pendingFocus.current = true; showAdd.value = false; };
  const newName = useSignal("");
  const newSecret = useSignal("");
  const newType = useSignal("secret");
  const keychainError = useSignal<string | null>(null);
  const loading = useSignal(true);
  const loadError = useSignal<string | null>(null);
  const keychainErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showConfirm } = useDialog();

  const showKeychainError = (msg: string) => {
    keychainError.value = msg;
    if (keychainErrorTimer.current) clearTimeout(keychainErrorTimer.current);
    keychainErrorTimer.current = setTimeout(() => (keychainError.value = null), 3000);
  };

  const fetchEntries = useCallback(async () => {
    loading.value = true;
    loadError.value = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch("/agent/keychain", { credentials: "same-origin", signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        loadError.value = `Failed to load keychain (HTTP ${res.status})`;
        loading.value = false;
        return;
      }
      const data = await res.json() as KeychainResponse;
      entries.value = data.entries ?? [];
      loadError.value = null;
    } catch (err: any) {
      loadError.value = err?.name === "AbortError" ? "Keychain request timed out" : "Failed to load keychain";
    } finally {
      loading.value = false;
    }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const addEntry = async () => {
    if (saving.value || !newName.value.trim() || !newSecret.value.trim()) return;
    saving.value = true;
    try {
      const res = await fetch("/agent/keychain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: newName.value.trim(), secret: newSecret.value, type: newType.value }),
      });
      if (!res.ok) {
        log.warn("add failed:", res.status);
        showKeychainError("Couldn't add entry. Please try again.");
        return;
      }
      newName.value = "";
      newSecret.value = "";
      finishAdd();
      announcement.value = "Keychain entry saved.";
      fetchEntries();
    } catch (err) {
      log.warn("add failed:", err);
      showKeychainError("Failed to add entry");
    } finally {
      saving.value = false;
    }
  };

  const deleteEntry = async (name: string) => {
    const confirmed = await showConfirm({
      title: `Delete keychain entry "${name}"?`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch("/agent/keychain", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        log.warn("delete failed:", res.status);
        showKeychainError("Couldn't delete entry. Please try again.");
        return;
      }
      pendingFocus.current = true;
      announcement.value = "Keychain entry deleted.";
      fetchEntries();
    } catch (err) {
      log.warn("delete failed:", err);
      showKeychainError("Failed to delete entry");
    }
  };

  useEffect(() => {
    if (showAdd.value) {
      const frame = requestAnimationFrame(() => nameRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [showAdd.value]);
  useEffect(() => {
    if (loading.value || !pendingFocus.current) return;
    const frame = requestAnimationFrame(() => {
      pendingFocus.current = false;
      addButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [loading.value, showAdd.value]);
  useEffect(() => () => { if (keychainErrorTimer.current) clearTimeout(keychainErrorTimer.current); }, []);

  const filtered = filter.value
    ? entries.value.filter(e => e.name.toLowerCase().includes(filter.value.toLowerCase()))
    : entries.value;

  return (
    <section className="settings-panel__section settings-panel__section--narrow settings-panel__section--keychain">
      <h2 className="settings-panel__section-title">Keychain</h2>
      <div role="status" aria-live="polite" aria-atomic="true">{announcement.value}</div>

      {keychainError.value && (
        <div role="alert" className="settings-panel__save-status settings-panel__save-status--error">{keychainError.value}</div>
      )}

      <div className="settings-panel__keychain-header">
        <input
          className="settings-panel__input settings-panel__keychain-filter"
          type="text"
          aria-label="Filter keychain entries"
          placeholder="Filter entries..."
          value={filter.value}
          onInput={(e) => (filter.value = (e.target as HTMLInputElement).value)}
        />
        <button ref={addButtonRef} type="button" className="settings-panel__provider-btn" aria-expanded={showAdd.value} aria-controls={`${prefix}-add-form`} onClick={() => { if (showAdd.value) finishAdd(); else showAdd.value = true; }}>
          + Add entry
        </button>
      </div>

      {loading.value && !entries.value.length && (
        <p className="settings-panel__description">Loading keychain...</p>
      )}
      {loadError.value && (
        <div role="alert" className="settings-panel__save-status settings-panel__save-status--error">
          {loadError.value}
          <button type="button" className="settings-panel__provider-btn" onClick={fetchEntries} style="margin-left:8px">Retry</button>
        </div>
      )}
      {!loading.value && !loadError.value && (
        <p className="settings-panel__description">
          {entries.value.length} entries, encrypted at rest.
        </p>
      )}

      {showAdd.value && (
        <div id={`${prefix}-add-form`} className="settings-panel__card settings-panel__card--spaced" role="group" aria-label="Add keychain entry" aria-busy={saving.value}>
          <h3 className="settings-panel__subsection-title">New entry</h3>
          <div className="settings-panel__field">
            <label htmlFor={`${prefix}-name`} className="settings-panel__label">Name</label>
            <input id={`${prefix}-name`} ref={nameRef} required aria-invalid={(newName.value.length > 0 && !newName.value.trim()) || undefined} className="settings-panel__input" type="text" placeholder="entry-name" value={newName.value} onInput={(e) => (newName.value = (e.target as HTMLInputElement).value)} />
          </div>
          <div className="settings-panel__field">
            <label htmlFor={`${prefix}-secret`} className="settings-panel__label">Secret</label>
            <input id={`${prefix}-secret`} required aria-invalid={(newSecret.value.length > 0 && !newSecret.value.trim()) || undefined} className="settings-panel__input" type="password" placeholder="secret value" value={newSecret.value} onInput={(e) => (newSecret.value = (e.target as HTMLInputElement).value)} />
          </div>
          <div className="settings-panel__field">
            <label htmlFor={`${prefix}-type`} className="settings-panel__label">Type</label>
            <CustomSelect
              id={`${prefix}-type`}
              className="settings-panel__select"
              options={[
                { value: "secret", label: "Secret" },
                { value: "token", label: "Token" },
                { value: "password", label: "Password" },
                { value: "basic", label: "Basic" },
              ]}
              value={newType.value}
              onChange={(v) => { newType.value = v; }}
            />
          </div>
          <div className="settings-panel__actions-row">
            <button type="button" className="settings-panel__provider-btn" disabled={saving.value || !newName.value.trim() || !newSecret.value.trim()} onClick={addEntry}>{saving.value ? "Saving…" : "Save"}</button>
            <button type="button" className="settings-panel__provider-btn" onClick={finishAdd}>Cancel</button>
          </div>
        </div>
      )}

      <table className="settings-panel__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Env Var</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && !loading.value && !loadError.value ? (
            <tr><td colSpan={5} className="settings-panel__table-empty">No keychain entries.</td></tr>
          ) : (
            filtered.map(e => (
              <tr key={e.name}>
                <td>{e.name}</td>
                <td>{e.type ?? "—"}</td>
                <td><code className="settings-panel__env-var">{e.envVar ?? "—"}</code></td>
                <td>{e.updatedAt ? new Date(e.updatedAt).toLocaleDateString() : "—"}</td>
                <td>
                  <button type="button" className="settings-panel__provider-btn settings-panel__provider-btn--logout" onClick={() => deleteEntry(e.name)} aria-label={`Delete ${e.name}`} title="Delete">
                    <i className="codicon codicon-trash" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

registerSettingsPane({
  id: "keychain",
  label: "Keychain",
  icon: <i className="codicon codicon-key" />,
  order: 31,
  component: () => <KeychainSection />,
});
