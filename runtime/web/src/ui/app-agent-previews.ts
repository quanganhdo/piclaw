import { estimatePreviewLines } from './app-helpers.js';
import { reconcileThoughtStreamText } from './thought-stream-reconciliation.js';

export interface AgentPreviewState {
  text: string;
  totalLines: number;
  fullText?: string;
}

export function inferAgentPreviewTotalLines(text: string, explicitTotalLines: unknown): number {
  return Number.isFinite(explicitTotalLines as number)
    ? Number(explicitTotalLines)
    : (text ? text.replace(/\r\n/g, '\n').split('\n').length : 0);
}

export function buildCollapsedAgentPreviewState(text: string, explicitTotalLines: unknown): AgentPreviewState {
  return {
    text,
    totalLines: inferAgentPreviewTotalLines(text, explicitTotalLines),
  };
}

export function buildExpandedAgentPreviewState(fullText: string, previousState: AgentPreviewState | null | undefined): AgentPreviewState {
  return {
    text: previousState?.text || '',
    totalLines: estimatePreviewLines(fullText),
    fullText,
  };
}

export function buildAuthoritativeAgentPreviewState(
  fullText: string,
  previousState: AgentPreviewState | null | undefined,
  options: { previewText?: string; totalLines?: unknown } = {},
): AgentPreviewState {
  const inferredTotalLines = estimatePreviewLines(fullText);
  const explicitTotalLines = Number.isFinite(options.totalLines as number)
    ? Number(options.totalLines)
    : 0;
  return {
    text: options.previewText ?? previousState?.text ?? '',
    totalLines: Math.max(inferredTotalLines, explicitTotalLines),
    fullText,
  };
}

export function mergeAgentPreviewSnapshot(
  previewText: string,
  explicitTotalLines: unknown,
  authoritativeFullText: string,
  previousState: AgentPreviewState | null | undefined,
): AgentPreviewState {
  if (!authoritativeFullText) {
    return buildCollapsedAgentPreviewState(previewText, explicitTotalLines);
  }
  return buildAuthoritativeAgentPreviewState(authoritativeFullText, previousState, {
    previewText,
    totalLines: explicitTotalLines,
  });
}

export function resolveAgentPlanText(currentPlan: string | null | undefined, text: string, mode: unknown): string {
  return mode === 'replace' ? text : `${currentPlan || ''}${text}`;
}

export function applyDraftDeltaBuffer(currentBuffer: string | null | undefined, data: Record<string, any> | null | undefined): string {
  let next = currentBuffer || '';
  if (data?.reset) {
    next = '';
  }
  if (data?.delta) {
    next += String(data.delta);
  }
  return next;
}

export function applyThoughtDeltaBuffer(currentBuffer: string | null | undefined, data: Record<string, any> | null | undefined): string {
  return reconcileThoughtStreamText(currentBuffer, data);
}
