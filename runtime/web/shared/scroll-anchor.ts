// Shared scroll-anchor state and behavior for both browser skins.
// UI-local modules re-export this source to preserve existing import paths.

/**
 * True when the browser performs native CSS scroll anchoring for `scroller`.
 * Requires the engine to support overflow-anchor AND the resolved value on the
 * scroller itself to not be `none` (we explicitly set overflow-anchor:auto on the
 * scrollers; overflow-anchor does not inherit, so this only detects `none` set
 * directly on the scroller - a safety check against a future override).
 */
export function scrollerNativelyAnchors(scroller: HTMLElement): boolean {
    const supported = typeof window !== "undefined"
        && !!window.CSS
        && typeof window.CSS.supports === "function"
        && window.CSS.supports("overflow-anchor", "auto");
    if (!supported) return false;
    try {
        return getComputedStyle(scroller).overflowAnchor !== "none";
    } catch {
        return true;
    }
}

// Direction of the scrollTop correction for a bottom-pinned column-reverse
// scroller under the convention this codebase asserts (scrollTop = 0 at the
// visual bottom, negative going up). To hold content fixed while the panel grows
// by d below the header, scrollTop must change by -d. Only WebKit runs this path;
// validated against real Safari.
export const ANCHOR_SIGN = -1;

/**
 * Pure, unit-testable target scrollTop that keeps the header fixed given the
 * scroller's total height change. The delta is quantised to device pixels so the
 * expand correction (-round(dH)) and collapse correction (+round(dH)) are exactly
 * symmetric - a full expand/collapse cycle returns scrollTop to its exact start
 * with NO accumulating drift. We measure from scrollHeight (not
 * getBoundingClientRect) because it shares scrollTop's coordinate space (they
 * agree under CSS/page zoom, where getBoundingClientRect does not).
 */
export function anchorTarget(snapTop: number, snapScrollH: number, scrollH: number, dpr: number): number {
    const step = dpr > 0 ? dpr : 1;
    const delta = Math.round((scrollH - snapScrollH) * step) / step;
    return snapTop + ANCHOR_SIGN * delta;
}

export interface HeaderAnchor {
    /** Snapshot scroll state at the start of a toggle, before the height change. */
    mark(): void;
    /** Apply the compensation immediately (call from a post-toggle layout effect). */
    compensate(): void;
    /** Detach the observer and, when this scroller has no anchors left, its listener. */
    dispose(): void;
}

const INERT: HeaderAnchor = { mark() {}, compensate() {}, dispose() {} };

// Cache the (relatively expensive) native-anchoring gate per scroller so N pills
// sharing one scroller don't each run CSS.supports + getComputedStyle on mount.
const gateCache = new WeakMap<HTMLElement, boolean>();
function nativelyAnchorsCached(scroller: HTMLElement): boolean {
    let v = gateCache.get(scroller);
    if (v === undefined) {
        v = scrollerNativelyAnchors(scroller);
        gateCache.set(scroller, v);
    }
    return v;
}

interface AnchorState {
    panel: HTMLElement;
    scroller: HTMLElement;
    controller: ScrollerController;
    snapTop: number;
    snapScrollH: number;
    snapClientW: number;
    marked: boolean;
    abandoned: boolean;
    ro: ResizeObserver;
}

// One controller per scroller: a SINGLE shared scroll listener (not one per pill)
// and a shared self-write suppression window, so a long conversation with many
// pills doesn't attach hundreds of scroll listeners.
interface ScrollerController {
    anchors: Set<AnchorState>;
    suppressUntil: number;
    onScroll: () => void;
}
const controllers = new WeakMap<HTMLElement, ScrollerController>();

function getController(scroller: HTMLElement): ScrollerController {
    let c = controllers.get(scroller);
    if (!c) {
        const controller: ScrollerController = { anchors: new Set(), suppressUntil: 0, onScroll: () => {} };
        controller.onScroll = () => {
            // Our own compensating writes fall inside the suppress window; anything
            // else is a genuine user scroll -> stop fighting the user this session.
            if (performance.now() <= controller.suppressUntil) return;
            for (const a of controller.anchors) a.abandoned = true;
        };
        scroller.addEventListener("scroll", controller.onScroll, { passive: true });
        controllers.set(scroller, controller);
        c = controller;
    }
    return c;
}

/**
 * True while the anchor is applying a programmatic scrollTop write to `scroller`.
 * The app's own scroll listeners (auto-follow / load-more) should consult this so
 * a compensation write is not mistaken for a user scroll. (Native scroll anchoring
 * fires no scroll event, so this is a WebKit-only concern.)
 */
export function isAnchorScrolling(scroller: HTMLElement | null | undefined): boolean {
    if (!scroller) return false;
    const c = controllers.get(scroller);
    return !!c && performance.now() <= c.suppressUntil;
}

function isColumnReverse(scroller: HTMLElement): boolean {
    try {
        return getComputedStyle(scroller).flexDirection === "column-reverse";
    } catch {
        return false;
    }
}

/**
 * Attach an anchor that keeps the header fixed while `panel` resizes inside
 * `scroller`. Returns an inert handle (no-op) when inputs are missing, when
 * ResizeObserver is unavailable, or when the scroller anchors natively - so the
 * caller can wire this unconditionally. `panel` is observed for resize; the scroll
 * delta is read from scroller.scrollHeight.
 */
export function attachHeaderAnchor(
    scroller: HTMLElement | null,
    panel: HTMLElement | null,
): HeaderAnchor {
    if (!scroller || !panel) return INERT;
    if (typeof ResizeObserver === "undefined") return INERT;
    if (nativelyAnchorsCached(scroller)) return INERT;

    const controller = getController(scroller);
    const state: AnchorState = {
        panel,
        scroller,
        controller,
        snapTop: scroller.scrollTop,
        snapScrollH: scroller.scrollHeight,
        snapClientW: scroller.clientWidth,
        marked: false,
        abandoned: false,
        ro: undefined as unknown as ResizeObserver,
    };

    const compensate = () => {
        if (!state.marked || state.abandoned) return;
        // A change in the scroller's width means a reflow (orientation change,
        // window/keyboard resize) re-wrapped unrelated messages too, so the
        // whole-scrollHeight delta no longer reflects only the panel - bail and
        // disarm rather than yank the scroll to a stale target.
        if (scroller.clientWidth !== state.snapClientW) {
            state.marked = false;
            return;
        }
        const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
        const target = anchorTarget(state.snapTop, state.snapScrollH, scroller.scrollHeight, dpr);
        if (Math.abs(target - scroller.scrollTop) < 0.5 / dpr) return;
        controller.suppressUntil = performance.now() + 200;
        scroller.scrollTop = target; // browser clamps to the valid range
    };

    state.ro = new ResizeObserver(compensate);
    state.ro.observe(panel);
    controller.anchors.add(state);

    return {
        mark() {
            // Only compensate in a column-reverse (bottom-pinned) scroller. In the
            // classic timeline's normal/search/hashtag mode the container is a
            // top-pinned `column`, where inserting content below the header does
            // NOT move it - compensating there would scroll the wrong way.
            if (!isColumnReverse(scroller)) {
                state.marked = false;
                return;
            }
            state.snapTop = scroller.scrollTop;
            state.snapScrollH = scroller.scrollHeight;
            state.snapClientW = scroller.clientWidth;
            state.marked = true;
            state.abandoned = false;
        },
        compensate,
        dispose() {
            state.ro.disconnect();
            controller.anchors.delete(state);
            if (controller.anchors.size === 0) {
                scroller.removeEventListener("scroll", controller.onScroll);
                controllers.delete(scroller);
            }
        },
    };
}
