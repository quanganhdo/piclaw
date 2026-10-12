export type SubmissionFeedbackState = 'sending' | null;

/** Local HTTP submission only; timeline/queue and native agent status own accepted work. */
export class SubmissionFeedback {
  private generation = 0;
  constructor(private readonly publish: (state: SubmissionFeedbackState) => void) {}
  begin(_chatJid: string): number {
    const generation = ++this.generation;
    this.publish('sending');
    return generation;
  }
  acknowledged(generation: number): void { this.finished(generation); }
  finished(generation: number): void {
    if (generation === this.generation) this.publish(null);
  }
  failed(generation: number): void { this.finished(generation); }
  reset(): void { this.generation++; this.publish(null); }
}
