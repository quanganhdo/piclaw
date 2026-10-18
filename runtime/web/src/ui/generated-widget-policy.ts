// Shared runtime policy for isolated, interactive HTML widgets in both UIs.
export function isGeneratedWidgetInteractive(widget: any): boolean {
  const kind = (widget?.artifact || {}).kind || widget?.kind || null;
  return kind === 'html' && (widget?.source === 'live' || (
    Array.isArray(widget?.capabilities) && widget.capabilities.some(
      (value: unknown) => typeof value === 'string' && value.trim().toLowerCase() === 'interactive',
    )
  ));
}

export function getGeneratedWidgetSandbox(widget: any): string {
  return isGeneratedWidgetInteractive(widget)
    ? 'allow-downloads allow-scripts allow-forms'
    : 'allow-downloads';
}

export function getGeneratedWidgetCsp(widget: any): string {
  const interactive = isGeneratedWidgetInteractive(widget);
  return [
    "default-src 'none'",
    "img-src data: blob: https: http:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data: https: http:",
    "media-src data: blob: https: http:",
    interactive ? "connect-src 'self'" : "connect-src 'none'",
    interactive ? "frame-src 'self'" : "frame-src 'none'",
    interactive ? "script-src 'unsafe-inline' 'self' 'wasm-unsafe-eval'" : "script-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
