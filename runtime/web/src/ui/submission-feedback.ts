export type SubmissionFeedbackState = 'sending' | 'waiting' | null;

/** Presentation-only feedback; never treats an unacknowledged POST as accepted. */
export class SubmissionFeedback {
  private generation = 0;
  private chatJid = '';
  private activityThreads = new Set<string>();
  private threadIds = new Set<string>();
  private state: SubmissionFeedbackState = null;

  constructor(private readonly publish: (state: SubmissionFeedbackState) => void) {}

  begin(chatJid: string): number {
    this.chatJid = chatJid;
    this.activityThreads.clear();
    this.threadIds.clear();
    this.set('sending');
    return ++this.generation;
  }

  acknowledged(generation: number, queued: boolean, threadId?: string | number | null, messageTimestamp?: string): void {
    if (generation !== this.generation) return;
    this.threadIds = new Set([threadId, messageTimestamp].filter(value => value != null && value !== '').map(String));
    this.set(queued || [...this.threadIds].some(key => this.activityThreads.has(key)) ? null : 'waiting');
  }

  finished(generation: number): void {
    if (generation === this.generation && this.state === 'sending') this.set(null);
  }

  failed(generation: number): void {
    if (generation === this.generation) this.set(null);
  }

  activity(chatJid: string, threadId?: string | number | null): void {
    if (this.state === null || chatJid !== this.chatJid || threadId == null) return;
    const key = String(threadId);
    this.activityThreads.add(key);
    if (this.activityThreads.size > 16) this.activityThreads.delete(this.activityThreads.values().next().value!);
    if (this.state === 'waiting' && this.threadIds.has(key)) this.set(null);
  }

  reset(): void {
    this.generation++;
    this.chatJid = '';
    this.set(null);
  }

  private set(state: SubmissionFeedbackState): void {
    this.state = state;
    this.publish(state);
  }
}

/** Only actual run/terminal feedback replaces the local acknowledgement cue. */
export function publishSubmissionRunStatus(chatJid: string, type: unknown, threadId: unknown): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('piclaw:submission-run-status', { detail: { chat_jid: chatJid, type, thread_id: threadId } }));
}

export function isSubmissionRunStatus(type: unknown): boolean {
  return typeof type === 'string' && ['thinking', 'running', 'tool_call', 'tool_status', 'compaction_start', 'recovering', 'retrying', 'waiting', 'pending_request', 'done', 'error'].includes(type);
}
