export type DictationState = 'idle' | 'loading' | 'recording' | 'finishing' | 'error';
export type DictationFinish = { status: 'finished' } | { status: 'cancelled' };
export interface DictationSession { finish(): Promise<DictationFinish>; cancel(): Promise<void> }
export interface ComposerDictationProvider {
  id: string;
  label: string;
  availability(): { available: boolean; reason?: string };
  start(context: {
    signal: AbortSignal;
    chatJid: string;
    setState(state: DictationState, message?: string): void;
    updateSegment(update: { segmentId: string; text: string; final: boolean }): { applied: boolean };
  }): Promise<DictationSession>;
}
export interface DictationDraft {
  text: string;
  revision: number;
  selectionStart: number;
  selectionEnd: number;
  chatJid: string;
}
export interface ComposerDictationHost {
  readDraft(): DictationDraft;
  /** Compare-and-set: a false return means a newer edit owns the draft. */
  writeDraft(text: string, expectedRevision: number): boolean;
  state(state: DictationState, message?: string): void;
}
interface Segment { id: string; text: string; final: boolean }

/** Core-owned selection anchor and final-result barrier; never owns Send itself. */
export class ComposerDictationController {
  private current: {
    controller: AbortController;
    provider: ComposerDictationProvider;
    chatJid: string;
    revision: number;
    start: number;
    end: number;
    text: string;
    segments: Segment[];
    starting: Promise<DictationSession>;
    finishing?: Promise<DictationFinish>;
    cancelling?: Promise<void>;
    error?: string;
  } | undefined;
  private pendingSubmit: Promise<boolean> | undefined;
  constructor(private readonly host: ComposerDictationHost, private readonly timeoutMs = 15000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw Error('Invalid dictation deadline.');
  }
  get active(): boolean { return !!this.current; }
  async start(provider: ComposerDictationProvider): Promise<void> {
    if (this.current) throw Error('A dictation session already owns this composer.');
    if (!provider.availability().available) { this.host.state('error', 'Selected dictation provider is unavailable.'); return; }
    const draft = this.host.readDraft();
    const controller = new AbortController();
    // Publish ownership before provider callbacks, including synchronous reentry.
    let resolve!: (session: DictationSession) => void, reject!: (error: unknown) => void;
    const starting = new Promise<DictationSession>((yes, no) => { resolve = yes; reject = no; });
    const owner = { controller, provider, chatJid: draft.chatJid, revision: draft.revision,
      start: Math.min(draft.selectionStart, draft.selectionEnd), end: Math.max(draft.selectionStart, draft.selectionEnd), text: draft.text, segments: [] as Segment[], starting };
    this.current = owner;
    this.host.state('loading');
    const acquired = Promise.resolve().then(() => provider.start({
      signal: controller.signal, chatJid: draft.chatJid,
      setState: state => {
        if(this.current!==owner||controller.signal.aborted)return;
        if(state==='error'){owner.error='Dictation provider failed. Draft preserved.';void this.cancel();this.host.state('error',owner.error);}
        else if (!owner.finishing || (state !== 'loading' && state !== 'recording')) this.host.state(state);
      },
      updateSegment: update => this.updateSegment(owner, update),
    }));
    void acquired.then(resolve, reject);
    // A late result remains owned by starting; cancellation awaits and disposes it once.
    try {
      await this.bounded(starting, controller.signal);
      if (this.current === owner && !controller.signal.aborted && !owner.finishing) this.host.state('recording');
    } catch {
      const cancelled = controller.signal.aborted;
      controller.abort();
      if(!cancelled)owner.error='Dictation could not start. Draft preserved.';
      void this.cancel();
      if (owner.error && this.current === owner) this.host.state('error', owner.error);
    }
  }
  private updateSegment(owner: NonNullable<ComposerDictationController['current']>, update: {segmentId: string; text: string; final: boolean}): {applied: boolean} {
    if (this.current !== owner || owner.controller.signal.aborted || !update.segmentId || update.segmentId.length > 128 || typeof update.text !== 'string' || update.text.length > 65536 || typeof update.final !== 'boolean') return {applied:false};
    const draft = this.host.readDraft();
    if (draft.chatJid !== owner.chatJid || draft.revision !== owner.revision || draft.text !== owner.text) return {applied:false};
    const previous = owner.segments.find(segment => segment.id === update.segmentId);
    if (previous?.final) return {applied:previous.text === update.text && update.final};
    const segments = owner.segments.map(segment => ({...segment}));
    const index = segments.findIndex(segment => segment.id === update.segmentId);
    const segment = {id:update.segmentId,text:update.text,final:update.final};
    if (index < 0) {
      if (segments.length >= 256) return {applied:false};
      segments.push(segment);
    } else segments[index] = segment;
    const insertion = segments.map(segment => segment.text).join('');
    if (insertion.length > 131072) return {applied:false};
    const text = draft.text.slice(0, owner.start) + insertion + draft.text.slice(owner.end);
    if (!this.host.writeDraft(text, draft.revision)) return {applied:false};
    const committed = this.host.readDraft();
    if (committed.chatJid !== owner.chatJid || committed.text !== text) return {applied:false};
    owner.segments = segments; owner.end = owner.start + insertion.length; owner.text = text; owner.revision = committed.revision;
    return {applied:true};
  }
  /** Call for every user/programmatic draft edit before allowing new callbacks. */
  draftChanged(before: DictationDraft, after: DictationDraft): void {
    const owner = this.current;
    if (!owner || owner.controller.signal.aborted) return;
    if (before.chatJid !== owner.chatJid || after.chatJid !== owner.chatJid || before.revision !== owner.revision || before.text !== owner.text) { void this.cancel(); return; }
    let prefix=0; while(prefix<before.text.length && prefix<after.text.length && before.text[prefix]===after.text[prefix])prefix++;
    let suffix=0; while(suffix<before.text.length-prefix && suffix<after.text.length-prefix && before.text.at(-1-suffix)===after.text.at(-1-suffix))suffix++;
    const removedEnd=before.text.length-suffix;
    const delta=after.text.length-before.text.length;
    if (removedEnd <= owner.start && prefix < owner.start) { owner.start+=delta; owner.end+=delta; }
    else if (prefix < owner.end || (owner.start===owner.end && prefix===owner.start)) { void this.cancel(); return; }
    owner.text=after.text; owner.revision=after.revision;
  }
  finish(): Promise<DictationFinish> {
    const owner=this.current;
    if (!owner) return Promise.resolve({status:'cancelled'});
    if (!owner.finishing) {
      this.host.state('finishing');
      owner.finishing=(async()=>{
        try {
          const session=await this.bounded(owner.starting,owner.controller.signal);
          const result=await this.bounded(Promise.resolve().then(()=>session.finish()),owner.controller.signal);
          if (owner.error)throw Error('Dictation provider failed.');
          if (this.current!==owner || owner.controller.signal.aborted) return {status:'cancelled'};
          if (result.status!=='finished') { void this.cancel(); return {status:'cancelled'}; }
          // Provider finish promises include final draft application; callbacks are fenced now.
          owner.controller.abort(); this.current=undefined; this.host.state('idle'); return result;
        } catch {
          if (owner.controller.signal.aborted && !owner.error) return {status:'cancelled'};
          if(this.current===owner){owner.error='Dictation could not finish. Draft preserved; send again explicitly.';void this.cancel();this.host.state('error',owner.error);}
          throw Error('Dictation finish failed.');
        }
      })();
    }
    return owner.finishing;
  }
  cancel(): Promise<void> {
    const owner=this.current;
    if (!owner) return Promise.resolve();
    owner.controller.abort();
    if (!owner.cancelling) owner.cancelling=(async()=>{
      try { const session=await owner.starting; await session.cancel(); }
      catch { owner.error ??= 'Dictation cleanup failed.'; }
      finally { if(this.current===owner){this.current=undefined;if(owner.error)this.host.state('error',owner.error);else this.host.state('idle');} }
    })();
    return owner.cancelling;
  }
  /** All Send entrypoints call this barrier; repeated intents share the first submission. */
  submit(send: () => Promise<void>): Promise<boolean> {
    if (this.pendingSubmit) return this.pendingSubmit;
    const owner=this.current;
    this.pendingSubmit=(async()=>{
      if(owner){const result=await this.finish();if(result.status!=='finished')return false;}
      await send(); return true;
    })().finally(()=>{this.pendingSubmit=undefined;});
    return this.pendingSubmit;
  }
  private bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve,reject)=>{
      let timer: ReturnType<typeof setTimeout>;
      const abort=()=>{clearTimeout(timer);reject(Error('Dictation cancelled.'));};
      if(signal.aborted){reject(Error('Dictation cancelled.'));return;}
      signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{signal.removeEventListener('abort',abort);reject(Error('Dictation deadline exceeded.'));},this.timeoutMs);
      void promise.then(value=>{clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(value);},error=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(error);});
    });
  }
}
