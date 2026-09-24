/** @jsx h */
import { h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  createPasskeyCredential,
  fetchPasskeyList,
  finishPasskeyRegistration,
  formatPasskeyLastUsed,
  formatPasskeyTimestamp,
  getAddPasskeyUnavailableReason,
  isAbortError,
  isPasskeyCreationCancelled,
  PasskeyApiError,
  type PasskeyEntry,
  type PasskeyListResponse,
  renamePasskey,
  removePasskey,
  serializePasskeyCredential,
  shortPasskeyId,
  startPasskeyRegistration,
  summarizePasskeyError,
  validatePasskeyName,
} from "./passkeys";

interface StatusState {
  kind: "success" | "info" | "error";
  text: string;
  refresh: boolean;
}

interface AuthBannerState {
  mode: "signin" | "recent-auth";
  message: string;
}

export function PasskeySettings() {

  const [snapshot, setSnapshot] = useState<PasskeyListResponse | null>(null);
  const [confirmedPasskeys, setConfirmedPasskeys] = useState<PasskeyEntry[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [authBanner, setAuthBanner] = useState<AuthBannerState | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPhase, setAddPhase] = useState<"idle" | "starting" | "prompt" | "finishing">("idle");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [renamePendingId, setRenamePendingId] = useState<string | null>(null);

  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removePendingId, setRemovePendingId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const hasLoadedRef = useRef(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const removeConfirmButtonRef = useRef<HTMLButtonElement>(null);
  const renameButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusRef = useRef<{ kind: "add" | "rename" | "remove"; id?: string } | null>(null);
  const ceremonyRef = useRef<AbortController | null>(null);
  const cancelMessageRef = useRef<string | null>(null);
  const prefixRef = useRef(`settings-auth-${Math.random().toString(36).slice(2, 9)}`);
  const fieldId = (suffix: string) => `${prefixRef.current}-${suffix}`;

  useEffect(() => {
    hasLoadedRef.current = hasLoaded;
  }, [hasLoaded]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelMessageRef.current = null;
      ceremonyRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!addOpen) return;
    const frame = requestAnimationFrame(() => addInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [addOpen]);

  useEffect(() => {
    if (!editingId) return;
    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingId]);

  useEffect(() => {
    if (!removeConfirmId) return;
    const frame = requestAnimationFrame(() => removeConfirmButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [removeConfirmId]);

  useEffect(() => {
    if (!pendingFocusRef.current) return;
    const { kind, id } = pendingFocusRef.current;
    const frame = requestAnimationFrame(() => {
      pendingFocusRef.current = null;
      if (kind === "add") {
        addButtonRef.current?.focus();
        return;
      }
      if (!id) return;
      const map = kind === "rename" ? renameButtonRefs.current : removeButtonRefs.current;
      map.get(id)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [addOpen, editingId, removeConfirmId, loading, confirmedPasskeys]);

  const clearPasskeyForms = useCallback(() => {
    setEditingId(null);
    setEditingValue("");
    setEditError(null);
    setRemoveConfirmId(null);
    setRemoveError(null);
  }, []);

  const refreshPasskeys = useCallback(async (options: { announce?: boolean } = {}): Promise<boolean> => {
    if (!options.announce) setStatus(null);
    setLoading(true);
    setLoadError(null);
    try {
      const next = await fetchPasskeyList();
      if (!mountedRef.current) return false;
      setSnapshot(next);
      setConfirmedPasskeys(next.passkeys);
      setHasLoaded(true);
      setStale(false);
      setAuthBanner(next.recent_auth
        ? null
        : { mode: "recent-auth", message: "Sign in again to add, rename, or remove passkeys. After you finish, return here and select Refresh." });
      if (options.announce) {
        setStatus({ kind: "success", text: "Passkeys refreshed.", refresh: false });
      }
      return true;
    } catch (error) {
      if (!mountedRef.current) return false;
      const summary = summarizePasskeyError(error, "Failed to load passkeys.");
      setLoadError(summary.message);
      if (summary.signInRequired) {
        setAuthBanner({ mode: "signin", message: "Sign in required to view or manage passkeys." });
      } else if (summary.recentAuthRequired) {
        setAuthBanner({ mode: "recent-auth", message: "Sign in again to add, rename, or remove passkeys. After you finish, return here and select Refresh." });
        setSnapshot((current) => (current ? { ...current, recent_auth: false } : current));
      }
      if (hasLoadedRef.current) setStale(true);
      return false;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPasskeys();
  }, [refreshPasskeys]);

  const rpId = snapshot?.rp_id || confirmedPasskeys[0]?.rpId || "";
  const reauthenticateUrl = snapshot?.reauthenticate_url || "/login";
  const addUnavailableReason = useMemo(() => {
    if (stale) return "Refresh passkeys before changing them.";
    if (authBanner?.mode === "signin") return authBanner.message;
    if ((snapshot?.recent_auth === false) || authBanner?.mode === "recent-auth") return "Sign in again before changing passkeys.";
    return getAddPasskeyUnavailableReason(snapshot);
  }, [authBanner, snapshot, stale]);
  const writesAllowed = !stale && !loading && authBanner === null && snapshot?.recent_auth === true;
  const busy = addPhase !== "idle" || Boolean(renamePendingId) || Boolean(removePendingId);

  const openAddForm = useCallback(() => {
    clearPasskeyForms();
    setStatus(null);
    setAddError(null);
    setAddOpen(true);
  }, [clearPasskeyForms]);

  const closeAddForm = useCallback(() => {
    if (addPhase !== "idle") {
      cancelMessageRef.current = "Passkey creation cancelled.";
      ceremonyRef.current?.abort();
    }
    setAddOpen(false);
    setAddError(null);
    pendingFocusRef.current = { kind: "add" };
  }, [addPhase]);

  const handleAddSubmit = useCallback(async () => {
    const validation = validatePasskeyName(addName);
    setAddName(validation.value);
    if (validation.ok === false) {
      setAddError(validation.error);
      return;
    }
    if (addUnavailableReason || !snapshot || busy) return;

    const controller = new AbortController();
    ceremonyRef.current = controller;
    cancelMessageRef.current = null;
    setAddError(null);
    setStatus({ kind: "info", text: "Requesting a fresh passkey ceremony…", refresh: false });
    setAddPhase("starting");

    let credentialCreated = false;
    try {
      const start = await startPasskeyRegistration(validation.value, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      setAddPhase("prompt");
      setStatus({ kind: "info", text: "Complete the browser's native passkey prompt.", refresh: false });
      const createSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
      const credential = await createPasskeyCredential(start.options, createSignal);
      if (controller.signal.aborted || !mountedRef.current) return;
      if (!credential) { setStatus({ kind: "info", text: "Passkey creation cancelled.", refresh: false }); return; }
      credentialCreated = true;
      setAddPhase("finishing");
      setStatus({ kind: "info", text: "Verifying the new passkey with the server…", refresh: false });
      await finishPasskeyRegistration(start.token, serializePasskeyCredential(credential), controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      setAddOpen(false);
      setAddName("");
      const refreshed = await refreshPasskeys();
      if (!mountedRef.current) return;
      setStatus(refreshed
        ? { kind: "success", text: "Passkey added.", refresh: false }
        : { kind: "info", text: "Passkey added, but the list could not be refreshed. Refresh to load the current state.", refresh: true });
    } catch (error) {
      if (!mountedRef.current) return;
      if (isAbortError(error) || (error instanceof Error && error.name === 'TimeoutError')) {
        setStatus(credentialCreated
          ? { kind: 'info', text: 'Registration could not be confirmed. Refresh the list; a local credential may remain in your authenticator.', refresh: true }
          : { kind: 'info', text: cancelMessageRef.current || 'Passkey creation timed out or was cancelled. Start again for a fresh ceremony.', refresh: false });
        return;
      }
      if (isPasskeyCreationCancelled(error)) {
        setStatus({ kind: "info", text: "Passkey creation was cancelled. Start again to request a fresh ceremony.", refresh: false });
        return;
      }
      const summary = summarizePasskeyError(error, "Passkey creation failed.");
      if (summary.signInRequired) {
        setAuthBanner({ mode: "signin", message: "Sign in required to manage passkeys." });
      } else if (summary.recentAuthRequired) {
        setAuthBanner({ mode: "recent-auth", message: "Sign in again to add, rename, or remove passkeys. After you finish, return here and select Refresh." });
        setSnapshot((current) => (current ? { ...current, recent_auth: false } : current));
      }
      if (credentialCreated) {
        const text = error instanceof PasskeyApiError && error.status >= 400 && error.status < 500
          ? `${summary.message} The credential was not registered on the server. A local credential may remain in your authenticator or password manager.`
          : `Registration could not be confirmed. Refresh to check whether the passkey was added. A local credential may remain in your authenticator or password manager.`;
        setAddOpen(false);
        setStatus({ kind: "error", text, refresh: true });
      } else {
        setAddError(summary.message);
        setStatus({ kind: "error", text: summary.message, refresh: false });
      }
    } finally {
      if (ceremonyRef.current === controller) ceremonyRef.current = null;
      cancelMessageRef.current = null;
      if (mountedRef.current) setAddPhase("idle");
    }
  }, [addName, addUnavailableReason, busy, refreshPasskeys, snapshot]);

  const openRename = useCallback((passkey: PasskeyEntry) => {
    setStatus(null);
    setAddOpen(false);
    setAddError(null);
    setRemoveConfirmId(null);
    setRemoveError(null);
    setEditingId(passkey.id);
    setEditingValue(passkey.name);
    setEditError(null);
  }, []);

  const cancelRename = useCallback((id: string) => {
    setEditingId(null);
    setEditingValue("");
    setEditError(null);
    pendingFocusRef.current = { kind: "rename", id };
  }, []);

  const submitRename = useCallback(async (passkey: PasskeyEntry) => {
    const validation = validatePasskeyName(editingValue);
    setEditingValue(validation.value);
    if (validation.ok === false) {
      setEditError(validation.error);
      return;
    }
    if (!writesAllowed || busy) return;
    setRenamePendingId(passkey.id);
    setEditError(null);
    setStatus({ kind: "info", text: "Saving passkey name…", refresh: false });
    try {
      await renamePasskey(passkey.id, validation.value);
      const refreshed = await refreshPasskeys();
      if (!mountedRef.current) return;
      setEditingId(null);
      setEditingValue("");
      setStatus(refreshed
        ? { kind: "success", text: "Passkey name saved.", refresh: false }
        : { kind: "info", text: "Passkey name saved, but the list could not be refreshed. Refresh to load the current state.", refresh: true });
    } catch (error) {
      if (!mountedRef.current) return;
      const summary = summarizePasskeyError(error, "Could not save the passkey name. Refresh before trying again.");
      if (summary.signInRequired) {
        setAuthBanner({ mode: "signin", message: "Sign in required to manage passkeys." });
      } else if (summary.recentAuthRequired) {
        setAuthBanner({ mode: "recent-auth", message: "Sign in again to add, rename, or remove passkeys. After you finish, return here and select Refresh." });
        setSnapshot((current) => (current ? { ...current, recent_auth: false } : current));
      }
      setEditError(error instanceof PasskeyApiError ? summary.message : "Could not confirm the saved name. Refresh before trying again; the change may already have completed.");
      setStatus({ kind: "error", text: summary.message, refresh: !((error instanceof PasskeyApiError)) });
    } finally {
      if (mountedRef.current) setRenamePendingId(null);
    }
  }, [busy, editingValue, refreshPasskeys, writesAllowed]);

  const openRemove = useCallback((passkey: PasskeyEntry) => {
    setStatus(null);
    setAddOpen(false);
    setAddError(null);
    setEditingId(null);
    setEditError(null);
    setRemoveConfirmId(passkey.id);
    setRemoveError(null);
  }, []);

  const cancelRemove = useCallback((id: string) => {
    setRemoveConfirmId(null);
    setRemoveError(null);
    pendingFocusRef.current = { kind: "remove", id };
  }, []);

  const confirmRemove = useCallback(async (passkey: PasskeyEntry) => {
    if (!writesAllowed || busy) return;
    setRemovePendingId(passkey.id);
    setRemoveError(null);
    setStatus({ kind: "info", text: "Removing passkey…", refresh: false });
    try {
      await removePasskey(passkey.id);
      const refreshed = await refreshPasskeys();
      if (!mountedRef.current) return;
      setRemoveConfirmId(null);
      setStatus(refreshed
        ? { kind: "success", text: "Passkey removed.", refresh: false }
        : { kind: "info", text: "Passkey removed, but the list could not be refreshed. Refresh to load the current state.", refresh: true });
    } catch (error) {
      if (!mountedRef.current) return;
      const summary = summarizePasskeyError(error, "Could not remove the passkey. Refresh before trying again.");
      if (summary.signInRequired) {
        setAuthBanner({ mode: "signin", message: "Sign in required to manage passkeys." });
      } else if (summary.recentAuthRequired) {
        setAuthBanner({ mode: "recent-auth", message: "Sign in again to add, rename, or remove passkeys. After you finish, return here and select Refresh." });
        setSnapshot((current) => (current ? { ...current, recent_auth: false } : current));
      }
      setRemoveError(error instanceof PasskeyApiError ? summary.message : "Could not confirm the removal. Refresh before trying again; the change may already have completed.");
      setStatus({ kind: "error", text: summary.message, refresh: !(error instanceof PasskeyApiError) });
    } finally {
      if (mountedRef.current) setRemovePendingId(null);
    }
  }, [busy, refreshPasskeys, writesAllowed]);

  return (
      <div className="passkey-settings" aria-busy={loading || addPhase !== "idle" || undefined}>
        <div className="passkey-settings__header">
          <div>
            <h3 className="settings-panel__subsection-title" style={{ marginTop: "28px" }}>Passkeys</h3>
            <p className="settings-panel__description">
              {rpId ? `Manage passkeys for ${rpId}.` : "Manage passkeys used to sign in with biometrics or a hardware key."}
            </p>
          </div>
          <div className="passkey-settings__header-actions">
            <button type="button" className="settings-panel__provider-btn" onClick={() => void refreshPasskeys({ announce: true })} disabled={loading || busy}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              ref={addButtonRef}
              type="button"
              className="settings-panel__provider-btn"
              onClick={openAddForm}
              disabled={!writesAllowed || Boolean(addUnavailableReason) || busy}
              aria-expanded={addOpen}
              aria-controls={fieldId("add-form")}
            >
              Add passkey
            </button>
          </div>
        </div>

        {authBanner && (
          <div className="passkey-settings__notice passkey-settings__notice--warning" role="status" aria-live="polite">
            <span>{authBanner.message}</span>
            <span className="passkey-settings__notice-actions">
              <a href={reauthenticateUrl} target="_blank" rel="noopener noreferrer" className="settings-panel__provider-btn">Sign in again</a>
              <button type="button" className="settings-panel__provider-btn" onClick={() => void refreshPasskeys({ announce: true })} disabled={loading || busy}>Refresh</button>
            </span>
          </div>
        )}

        {status && (
          <div className={`passkey-settings__status passkey-settings__status--${status.kind}`} role={status.kind === "error" ? "alert" : "status"} aria-live={status.kind === "error" ? "assertive" : "polite"}>
            <span>{status.text}</span>
            {status.refresh && (
              <button type="button" className="settings-panel__provider-btn" onClick={() => void refreshPasskeys({ announce: true })} disabled={loading || busy}>Refresh</button>
            )}
          </div>
        )}

        {loadError && (
          <div className="passkey-settings__notice passkey-settings__notice--error" role="alert">
            <span>{loadError}</span>
            <span className="passkey-settings__notice-actions">
              {authBanner?.mode === "signin" && (
                <a href={reauthenticateUrl} target="_blank" rel="noopener noreferrer" className="settings-panel__provider-btn">Sign in</a>
              )}
              <button type="button" className="settings-panel__provider-btn" onClick={() => void refreshPasskeys({ announce: true })} disabled={loading || busy}>Retry</button>
            </span>
          </div>
        )}

        {stale && (
          <p className="passkey-settings__help" role="status" aria-live="polite">
            Showing the last confirmed list. Refresh before making another change.
          </p>
        )}

        {addOpen && (
          <form
            id={fieldId("add-form")}
            className="passkey-settings__card passkey-settings__card--form"
            onSubmit={(event) => {
              event.preventDefault();
              if (addPhase === "idle") void handleAddSubmit();
            }}
          >
            <div className="passkey-settings__inline-form">
              <label htmlFor={fieldId("add-name")} className="passkey-settings__meta-label">Passkey name</label>
              <input
                id={fieldId("add-name")}
                ref={addInputRef}
                className="settings-panel__input passkey-settings__input"
                type="text"
                maxLength={160}
                value={addName}
                onInput={(event) => {
                  setAddName(event.currentTarget.value);
                  setAddError(null);
                }}
                aria-invalid={addError ? true : undefined}
                aria-describedby={addError ? fieldId("add-error") : fieldId("add-help")}
                disabled={addPhase !== "idle"}
              />
              <p id={fieldId("add-help")} className="passkey-settings__help">Use 1–80 characters. Surrounding spaces are trimmed.</p>
              {addError && <p id={fieldId("add-error")} className="passkey-settings__error" role="alert">{addError}</p>}
              {addPhase === "prompt" && <p className="passkey-settings__help" role="status">The browser prompt may take focus while you choose an authenticator.</p>}
              <div className="passkey-settings__actions">
                <button type="submit" className="settings-panel__provider-btn" disabled={addPhase !== "idle" || Boolean(addUnavailableReason)}>
                  {addPhase === "starting" ? "Starting…" : addPhase === "prompt" ? "Waiting for prompt…" : addPhase === "finishing" ? "Verifying…" : "Create passkey"}
                </button>
                <button type="button" className="settings-panel__provider-btn" onClick={closeAddForm}>
                  {addPhase === "idle" ? "Cancel" : "Cancel prompt"}
                </button>
              </div>
            </div>
          </form>
        )}

        {!addOpen && addUnavailableReason && (
          <p className="passkey-settings__help" role="status" aria-live="polite">{addUnavailableReason}</p>
        )}

        {loading && !hasLoaded ? (
          <p className="settings-panel__description" role="status">Loading passkeys…</p>
        ) : hasLoaded && confirmedPasskeys.length === 0 ? (
          <div className="passkey-settings__empty">
            <strong>No passkeys registered.</strong>
            <span>After a successful registration, new passkeys appear here with their last-used time.</span>
          </div>
        ) : hasLoaded ? (
          <div className="passkey-settings__list" role="list" aria-label="Registered passkeys">
            {confirmedPasskeys.map((passkey) => {
              const isEditing = editingId === passkey.id;
              const isRemoving = removeConfirmId === passkey.id;
              const renameBusy = renamePendingId === passkey.id;
              const removeBusy = removePendingId === passkey.id;
              const removeDisabled = !writesAllowed || !passkey.removable || busy;
              return (
                <article key={passkey.id} className="passkey-settings__card" role="listitem">
                  <div className="passkey-settings__card-header">
                    <div>
                      <h4 className="passkey-settings__name">{passkey.name}</h4>
                      <div className="passkey-settings__badges">
                        {!passkey.usable && <span className="passkey-settings__badge">Not usable under the current policy</span>}
                        {snapshot?.recent_auth && !passkey.removable && <span className="passkey-settings__badge">Another usable sign-in method must remain before removal</span>}
                        <span className="passkey-settings__badge">{passkey.rpId}</span>
                      </div>
                    </div>
                    <div className="passkey-settings__actions">
                      <button
                        ref={(node) => {
                          if (node) renameButtonRefs.current.set(passkey.id, node);
                          else renameButtonRefs.current.delete(passkey.id);
                        }}
                        type="button"
                        className="settings-panel__provider-btn"
                        onClick={() => openRename(passkey)}
                        disabled={!writesAllowed || busy}
                      >
                        Rename
                      </button>
                      <button
                        ref={(node) => {
                          if (node) removeButtonRefs.current.set(passkey.id, node);
                          else removeButtonRefs.current.delete(passkey.id);
                        }}
                        type="button"
                        className="settings-panel__provider-btn settings-panel__provider-btn--logout"
                        onClick={() => openRemove(passkey)}
                        disabled={removeDisabled}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <dl className="passkey-settings__meta">
                    <div>
                      <dt>Identifier</dt>
                      <dd><code className="settings-panel__env-var passkey-settings__id">{shortPasskeyId(passkey.id)}</code></dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>{formatPasskeyTimestamp(passkey.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Last used</dt>
                      <dd>{formatPasskeyLastUsed(passkey.lastUsedAt)}</dd>
                    </div>
                  </dl>

                  {isEditing && (
                    <form className="passkey-settings__inline-form" onSubmit={(event) => { event.preventDefault(); void submitRename(passkey); }}>
                      <label htmlFor={fieldId(`rename-${passkey.id}`)} className="passkey-settings__meta-label">Rename passkey</label>
                      <input
                        id={fieldId(`rename-${passkey.id}`)}
                        ref={renameInputRef}
                        className="settings-panel__input passkey-settings__input"
                        type="text"
                        maxLength={160}
                        value={editingValue}
                        onInput={(event) => {
                          setEditingValue(event.currentTarget.value);
                          setEditError(null);
                        }}
                        aria-invalid={editError ? true : undefined}
                        aria-describedby={editError ? fieldId(`rename-error-${passkey.id}`) : undefined}
                        disabled={renameBusy}
                      />
                      {editError && <p id={fieldId(`rename-error-${passkey.id}`)} className="passkey-settings__error" role="alert">{editError}</p>}
                      <div className="passkey-settings__actions">
                        <button type="submit" className="settings-panel__provider-btn" disabled={renameBusy}>{renameBusy ? "Saving…" : "Save"}</button>
                        <button type="button" className="settings-panel__provider-btn" onClick={() => cancelRename(passkey.id)} disabled={renameBusy}>Cancel</button>
                      </div>
                    </form>
                  )}

                  {isRemoving && (
                    <div className="passkey-settings__inline-form passkey-settings__inline-form--danger" role="group" aria-label={`Remove ${passkey.name}`}>
                      <p>
                        Remove <strong>{passkey.name}</strong> (<code className="settings-panel__env-var passkey-settings__id">{shortPasskeyId(passkey.id)}</code>)? This blocks future sign-ins with this credential. Existing login sessions are not signed out by this action.
                      </p>
                      {removeError && <p className="passkey-settings__error" role="alert">{removeError}</p>}
                      <div className="passkey-settings__actions">
                        <button ref={removeConfirmButtonRef} type="button" className="settings-panel__provider-btn settings-panel__provider-btn--logout" onClick={() => void confirmRemove(passkey)} disabled={removeBusy}>{removeBusy ? "Removing…" : "Remove passkey"}</button>
                        <button type="button" className="settings-panel__provider-btn" onClick={() => cancelRemove(passkey.id)} disabled={removeBusy}>Cancel</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
  );
}
