import { formatBytesCompact } from "../utils/format";



interface StatsData {
  cpu_percent: number;
  ram_percent: number;
  swap_percent: number | null;
  buffer_cache_bytes: number;
  vram_percent: number | null;
  gpu_provider: string | null;
  process_memory?: {
    rss_bytes: number;
  };
}

type MetricSeverity = "normal" | "warning" | "error";

export function formatClock(date: Date): string {
  const dayName = new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date);
  const day = date.getDate();
  const month = new Intl.DateTimeFormat("en-GB", { month: "short" }).format(date);
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${dayName}, ${day} ${month} ${year} \u2014 ${hours}:${minutes}`;
}



function percentSeverity(value: number | null): MetricSeverity {
  if (value == null || Number.isNaN(value)) return "normal";
  if (value > 85) return "error";
  if (value >= 60) return "warning";
  return "normal";
}

function swapSeverity(value: number | null): MetricSeverity {
  if (value != null && value > 0) return "warning";
  return "normal";
}

function valueClassName(severity: MetricSeverity): string {
  if (severity === "error") return "sys-stats__value sys-stats__value--error";
  if (severity === "warning") return "sys-stats__value sys-stats__value--warning";
  return "sys-stats__value";
}

function Metric({ icon, title, value, severity = "normal", label }: {
  icon: string; title: string; value: string; severity?: MetricSeverity; label?: string;
}) {
  return (
    <span className="sys-stats__metric" title={title}>
      <span className={`sys-stats__icon codicon ${icon}`} aria-hidden="true" />
      {label && <span className="sys-stats__label">{label}</span>}
      <span className={valueClassName(severity)}>{value}</span>
    </span>
  );
}

function buildMetrics(stats: StatsData | null, withLabels = false) {
  if (!stats) {
    return [
      <Metric key="cpu" icon="codicon-pulse" title="CPU" value="--" label={withLabels ? "CPU" : undefined} />,
      <Metric key="ram" icon="codicon-circuit-board" title="RAM" value="--" label={withLabels ? "RAM" : undefined} />,
    ];
  }

  const rssBytes = stats.process_memory?.rss_bytes;
  const metrics = [
    <Metric key="cpu" icon="codicon-pulse" title="CPU usage" value={`${stats.cpu_percent}%`} severity={percentSeverity(stats.cpu_percent)} label={withLabels ? "CPU" : undefined} />,
    <Metric key="ram" icon="codicon-circuit-board" title="RAM usage" value={`${stats.ram_percent}%`} severity={percentSeverity(stats.ram_percent)} label={withLabels ? "RAM" : undefined} />,
  ];
  if (rssBytes != null && Number.isFinite(rssBytes) && rssBytes > 0) metrics.push(<Metric key="rss" icon="codicon-package" title="Process RSS" value={formatBytesCompact(rssBytes)} label={withLabels ? 'RSS' : undefined} />);
  if (stats.swap_percent != null && Number.isFinite(stats.swap_percent) && stats.swap_percent >= 0) metrics.push(<Metric key="swp" icon="codicon-arrow-swap" title="Swap usage" value={`${stats.swap_percent}%`} severity={swapSeverity(stats.swap_percent)} label={withLabels ? 'SWP' : undefined} />);
  if (Number.isFinite(stats.buffer_cache_bytes) && stats.buffer_cache_bytes > 0) metrics.push(<Metric key="buf" icon="codicon-database" title="Buffer/cache" value={formatBytesCompact(stats.buffer_cache_bytes)} label={withLabels ? 'BUF' : undefined} />);
  if (stats.gpu_provider && stats.vram_percent != null && Number.isFinite(stats.vram_percent) && stats.vram_percent >= 0 && stats.vram_percent <= 100) {
    metrics.push(
      <Metric key="gpu" icon="codicon-server-process" title="GPU memory usage" value={`${stats.vram_percent}%`} severity={percentSeverity(stats.vram_percent)} label={withLabels ? "GPU" : undefined} />
    );
  }
  return metrics;
}

function StatsDisplay({ stats, isStale }: { stats: StatsData | null; isStale: boolean }) {
  return (
    <span className="sys-stats">
      {isStale && <span className="sys-stats__stale" title="System stats unavailable">⚠</span>}
      {buildMetrics(stats)}
    </span>
  );
}

function StatsBar({ stats, isStale }: { stats: StatsData | null; isStale: boolean }) {
  return (
    <span className="sys-stats sys-stats--bar">
      {isStale && <span className="sys-stats__stale" title="System stats unavailable">⚠</span>}
      {buildMetrics(stats, true)}
    </span>
  );
}

export function SystemStats({ stats, isStale }: { stats: StatsData | null; isStale: boolean }) {
  return (
    <span className="sys-stats-bar">
      {/* Inline metrics for wide screens */}
      <span className="sys-stats-bar__inline">
        <StatsDisplay stats={stats} isStale={isStale} />
      </span>
      {/* Stats bar for narrow screens */}
      <span className="sys-stats-bar__compact">
        <StatsBar stats={stats} isStale={isStale} />
      </span>
    </span>
  );
}
