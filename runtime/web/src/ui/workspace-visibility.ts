export const DESKTOP_WORKSPACE_LAYOUT_MEDIA_QUERY = '(min-width: 1024px) and (orientation: landscape)';

export type WorkspaceLayoutBucket = 'desktop' | 'narrow';

function getRuntimeWindow(runtime: any = typeof window !== 'undefined' ? window : null) {
  return runtime && typeof runtime === 'object' ? runtime : null;
}

export function resolveWorkspaceLayoutBucket(runtime: any = typeof window !== 'undefined' ? window : null): WorkspaceLayoutBucket {
  const runtimeWindow = getRuntimeWindow(runtime);
  if (!runtimeWindow?.matchMedia) return 'desktop';
  return runtimeWindow.matchMedia(DESKTOP_WORKSPACE_LAYOUT_MEDIA_QUERY).matches ? 'desktop' : 'narrow';
}

export function shouldCollapseWorkspaceAfterLayoutChange(
  previousBucket: WorkspaceLayoutBucket,
  nextBucket: WorkspaceLayoutBucket,
): boolean {
  return previousBucket === 'desktop' && nextBucket === 'narrow';
}
