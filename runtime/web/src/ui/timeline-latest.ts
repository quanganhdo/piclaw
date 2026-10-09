export const TIMELINE_JUMP_LATEST_EVENT = 'piclaw:jump-timeline-latest';
export interface TimelineLatestState { away: boolean; hasNew: boolean }
/** Per-scroller lifecycle; never move a user reading history on new posts. */
export function bindTimelineLatest(scroller: HTMLElement, notify: (state: TimelineLatestState) => void) {
    let disposed = false, frame = 0, hasNew = false, lastId = 0, wasAway = Math.abs(scroller.scrollTop) > 60;
    let published: TimelineLatestState | null = null;
    const update = () => {
        frame = 0;
        if (disposed || !scroller.isConnected || !scroller.clientHeight) return;
        const away = Math.abs(scroller.scrollTop) > 60;
        if (!away) hasNew = false;
        wasAway = away;
        if (!published || published.away !== away || published.hasNew !== hasNew) { published = { away, hasNew }; notify(published); }
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(update); };
    const jump = () => { scroller.scrollTop = 0; hasNew = false; wasAway = false; schedule(); };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule), mutation = new MutationObserver(schedule);
    resize?.observe(scroller); mutation.observe(scroller, { childList: true, subtree: true });
    scroller.addEventListener('scroll', schedule, { passive: true }); scroller.addEventListener(TIMELINE_JUMP_LATEST_EVENT, jump);
    schedule();
    return {
        markNewMessages() { hasNew = true; schedule(); },
        noteLatest(id: number) { if (lastId && id > lastId && (wasAway || Math.abs(scroller.scrollTop) > 60)) hasNew = true; lastId = Math.max(lastId, id); schedule(); },
        dispose() { disposed = true; if (frame) cancelAnimationFrame(frame); resize?.disconnect(); mutation.disconnect(); scroller.removeEventListener('scroll', schedule); scroller.removeEventListener(TIMELINE_JUMP_LATEST_EVENT, jump); },
    };
}
export function jumpTimelineToLatest(scroller: HTMLElement | null) {
    if (!scroller) return;
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event(TIMELINE_JUMP_LATEST_EVENT));
    requestAnimationFrame(() => { if (scroller.isConnected) { scroller.scrollTop = 0; scroller.dispatchEvent(new Event(TIMELINE_JUMP_LATEST_EVENT)); } });
}
