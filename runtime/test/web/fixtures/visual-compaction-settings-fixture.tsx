import { render } from "preact";

import { CompactionSection } from "../../../web/static/visual/frontend/src/panels/settings/CompactionSection";
import type { SettingsData } from "../../../web/static/visual/frontend/src/panels/settings/types";

const settings: SettingsData = {
  autoCompactionEnabled: true,
  smartCompactionMethod: "selective",
  compactionModel: "openai/gpt-5.4",
  remoteCompactionEnabled: true,
  remoteCompactionTimeoutSec: 300,
  remoteCompactionSupportedProviders: ["openai", "openai-codex"],
  compactionTimeoutSec: 300,
  compactionBackoffBaseMin: 15,
  compactionBackoffMaxMin: 360,
  compactionThresholdPercent: 80,
  progressWatchdogEnabled: false,
  progressWatchdogTimeoutSec: 300,
  toolResultCompactionEnabled: true,
  toolResultCompactionTools: ["read", "bash"],
  toolResultSemanticSummaryEnabled: true,
  toolResultSemanticSummaryMaxInputChars: 12_000,
  toolResultSemanticSummaryMaxTokens: 320,
  toolResultSemanticSummaryTimeoutSec: 12,
  compactionBackoffs: [],
  progressWatchdogPhases: [],
};

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
  if (url.pathname === "/agent/models") {
    return Response.json({
      current: "openai/gpt-5.4",
      models: ["openai/gpt-5.4", "anthropic/claude-sonnet-4-5"],
      model_options: [
        { label: "openai/gpt-5.4", provider: "openai", id: "gpt-5.4", name: "GPT-5.4", context_window: 400_000 },
        { label: "anthropic/claude-sonnet-4-5", provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", context_window: 200_000 },
      ],
      provider_diagnostics: { providers: [{ provider: "openai", auth_configured: true }, { provider: "anthropic", auth_configured: true }] },
    });
  }
  if (url.pathname.startsWith("/agent/settings/")) return Response.json({ ok: true, settings });
  return originalFetch(input, init);
};

render(
  <div className="settings-panel settings-compaction-fixture">
    <div className="settings-panel__content">
      <CompactionSection data={settings} onSaveCompaction={() => {}} />
    </div>
  </div>,
  document.getElementById("visual-compaction-settings-fixture-root")!,
);
