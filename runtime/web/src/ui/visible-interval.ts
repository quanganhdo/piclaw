export function createVisibleInterval(callback: () => void, intervalMs: number, options: { document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>; window?: Pick<Window, 'setInterval' | 'clearInterval'>; refreshOnVisible?: boolean } = {}): () => void {
  const doc = options.document ?? document;
  const win = options.window ?? window;
  let timer = 0;
  let disposed = false;
  const stop = () => { if (timer) win.clearInterval(timer); timer = 0; };
  const start = (refresh: boolean) => {
    if (disposed || doc.visibilityState === 'hidden' || timer) return;
    if (refresh) callback();
    timer = Number(win.setInterval(callback, intervalMs));
  };
  const changed = () => doc.visibilityState === 'hidden' ? stop() : start(options.refreshOnVisible !== false);
  doc.addEventListener('visibilitychange', changed);
  start(false);
  return () => { disposed = true; stop(); doc.removeEventListener('visibilitychange', changed); };
}
