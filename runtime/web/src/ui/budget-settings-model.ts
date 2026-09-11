export const BUDGET_SCOPE_LABELS = {
  task: 'Current work',
  instance_daily: 'Daily instance',
  instance_monthly: 'Monthly instance',
  scheduled_run: 'Scheduled run',
  provider_window: 'Provider guard',
};

export const BUDGET_METRIC_LABELS = {
  api_usd_micros: 'API-equivalent USD',
  provider_percent_used_micros: 'Percent used',
  provider_credits_remaining_micros: 'Credits remaining floor',
  provider_key_usd_micros: 'Key USD used',
};

export function decimalToMicrosInput(value) {
  const text = String(value ?? '').trim();
  return /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text) ? text : null;
}

export function formatBudgetAmount(value, metric = 'api_usd_micros') {
  if (!Number.isSafeInteger(value)) return 'Unknown';
  const absolute = Math.abs(value);
  const decimal = `${Math.floor(absolute / 1_000_000)}.${String(absolute % 1_000_000).padStart(6, '0')}`
    .replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  const signed = value < 0 ? `-${decimal}` : decimal;
  if (metric === 'api_usd_micros' || metric === 'provider_key_usd_micros') return `$${signed}`;
  if (metric === 'provider_percent_used_micros') return `${signed}%`;
  return `${signed} credits`;
}

export function formatBudgetDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

export function budgetEvidenceState(cap) {
  if (cap?.scope !== 'provider_window') return null;
  const evidence = cap.evidence;
  if (!evidence) return { state: 'unknown', label: 'No provider evidence' };
  if (evidence.availability !== 'available') return { state: 'unknown', label: 'Provider evidence unavailable' };
  if (evidence.stale) return { state: 'stale', label: 'Provider evidence stale' };
  if (evidence.value_micros == null) return { state: 'unknown', label: 'Provider value unknown' };
  return { state: 'fresh', label: `Fresh · ${formatBudgetDate(evidence.fetched_at)}` };
}

export function defaultBudgetCapDraft(payload: Record<string, any> = {}) {
  return {
    id: '',
    scope: 'instance_daily',
    metric: 'api_usd_micros',
    amount: '',
    timezone: payload.timezone || 'UTC',
    provider_id: payload.provider_capabilities?.[0]?.provider_id || 'openai-codex',
    quota_dimension: payload.provider_capabilities?.[0]?.dimensions?.[0] || 'primary.percent_used',
    confirm_revision: null,
  };
}

export function capToBudgetDraft(cap, payload: Record<string, any> = {}) {
  return {
    id: cap.id,
    scope: cap.scope,
    metric: cap.metric,
    amount: String(Number(cap.amount || 0) / 1_000_000),
    timezone: cap.timezone || payload.timezone || 'UTC',
    provider_id: cap.provider_id || 'openai-codex',
    quota_dimension: cap.quota_dimension || 'primary.percent_used',
    confirm_revision: cap.revision,
  };
}

export function normalizeBudgetCapDraft(draft, payload: Record<string, any> = {}) {
  const scope = String(draft.scope || 'instance_daily');
  const provider = payload.provider_capabilities?.find((item) => item.provider_id === draft.provider_id)
    || payload.provider_capabilities?.[0];
  const quotaDimension = provider?.dimensions?.includes(draft.quota_dimension)
    ? draft.quota_dimension
    : provider?.dimensions?.[0] || '';
  let metric = 'api_usd_micros';
  if (scope === 'provider_window') {
    metric = quotaDimension === 'credits.remaining'
      ? 'provider_credits_remaining_micros'
      : quotaDimension === 'key.usd.used'
        ? 'provider_key_usd_micros'
        : 'provider_percent_used_micros';
  }
  return { ...draft, scope, metric, provider_id: provider?.provider_id || '', quota_dimension: quotaDimension };
}

export function buildBudgetSaveRequest(draft, payload: Record<string, any> = {}) {
  const normalized = normalizeBudgetCapDraft(draft, payload);
  const amount = decimalToMicrosInput(normalized.amount);
  if (amount == null) throw new Error('Enter a non-negative amount with at most six decimal places.');
  const body: Record<string, any> = {
    action: 'save_cap',
    ...(normalized.id ? { id: normalized.id } : {}),
    scope: normalized.scope,
    metric: normalized.metric,
    amount,
    ...(normalized.confirm_revision ? { confirm_revision: normalized.confirm_revision } : {}),
  };
  if (normalized.scope === 'instance_daily' || normalized.scope === 'instance_monthly') body.timezone = normalized.timezone;
  if (normalized.scope === 'provider_window') {
    body.provider_id = normalized.provider_id;
    body.quota_dimension = normalized.quota_dimension;
  }
  return body;
}

export function requestBudgetSettingsSection(section) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('piclaw:open-settings', { detail: { section } }));
}
