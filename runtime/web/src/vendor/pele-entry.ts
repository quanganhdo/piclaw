/** Timeline renderer. The separate beautifulMermaid asset retains the legacy widget API. */
import { render } from 'pele';
import { sanitizeDiagramSvg } from '../ui/diagram-sanitizer';
import { MERMAID_THEME_COLORS } from '../ui/svg-theme';

export const DIAGRAM_LIMITS = Object.freeze({ limit: 50_000, outputLimit: 4_000_000, maxEdges: 5_000 });
let nextId = 0;

export function renderDiagram(source: string): string {
  const { svg } = render(source, {
    ...DIAGRAM_LIMITS,
    fontFamily: 'system-ui',
    fontFamilyMono: 'monospace',
    autoDirection: false,
    links: false,
    images: false,
    idPrefix: 'piclaw-diagram-' + ++nextId,
  });
  // Keep the palette live across host theme changes; no DOM or colour sampling.
  const colors = {
    bg: MERMAID_THEME_COLORS.bg, fg: MERMAID_THEME_COLORS.fg,
    line: MERMAID_THEME_COLORS.line, muted: MERMAID_THEME_COLORS.muted,
    surface: MERMAID_THEME_COLORS.surface, 'surface-alt': MERMAID_THEME_COLORS.surface,
    border: MERMAID_THEME_COLORS.border, accent: MERMAID_THEME_COLORS.accent,
    critical: 'var(--danger-color, #cf222e)',
    'series-1': MERMAID_THEME_COLORS.accent,
    'series-2': 'var(--warning-color, #9a6700)',
    'series-3': 'var(--success-color, #1a7f37)',
    'series-4': 'var(--danger-color, #cf222e)',
    'series-5': MERMAID_THEME_COLORS.muted,
    'series-6': MERMAID_THEME_COLORS.border,
    'series-7': MERMAID_THEME_COLORS.fg,
    'series-8': MERMAID_THEME_COLORS.line,
  };
  const variables = Object.entries(colors).map(([key, value]) => '--pele-' + key + ':' + value).join(';');
  return svg.replace('style="', 'style="' + variables + ';');
}

globalThis.piclawDiagrams = { render: renderDiagram, sanitize: sanitizeDiagramSvg };
