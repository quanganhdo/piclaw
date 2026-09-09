import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { requireDisposableTestTarget } from '../../../runtime/scripts/test-target.js';

export type E2eAuthBootstrapResult = {
  attempted: boolean;
  authenticated: boolean;
  status?: number;
  error?: string;
  cookieHeader?: string;
};

function resolveInternalSecret(): string {
  return (process.env.PICLAW_E2E_INTERNAL_SECRET || '').trim();
}

function normalizeBaseUrl(baseURL: string): string {
  return requireDisposableTestTarget(baseURL);
}

export async function bootstrapE2eAuth(
  _request: APIRequestContext,
  baseURL: string,
): Promise<E2eAuthBootstrapResult> {
  baseURL = normalizeBaseUrl(baseURL);
  const secret = resolveInternalSecret();
  if (!secret) return { attempted: false, authenticated: false };

  try {
    // Use the runtime fetch implementation instead of Playwright's
    // APIRequestContext: browser-context request can throw URL parsing errors
    // after a successful Set-Cookie response on authenticated remote targets.
    const response = await fetch(`${normalizeBaseUrl(baseURL)}/auth/e2e/bootstrap`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'x-piclaw-internal-secret': secret,
      },
    });
    if (!response.ok) {
      return { attempted: true, authenticated: false, status: response.status, error: await response.text().catch(() => '') };
    }
    return { attempted: true, authenticated: true, status: response.status, cookieHeader: response.headers.get('set-cookie') || '' };
  } catch (error) {
    return { attempted: true, authenticated: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function authenticatePage(page: Page, baseURL: string): Promise<E2eAuthBootstrapResult> {
  return await bootstrapE2eAuth(page.context().request, baseURL);
}

export async function authenticatedContext(
  browser: Browser,
  baseURL: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const result = await bootstrapE2eAuth(context.request, baseURL);
  if (result.attempted && !result.authenticated) {
    await context.close();
    throw new Error(`E2E auth bootstrap failed${result.status ? ` with HTTP ${result.status}` : ''}${result.error ? `: ${result.error}` : ''}`);
  }
  return context;
}
