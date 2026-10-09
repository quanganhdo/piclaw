import { useState, useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { Signal } from "@preact/signals";
import { buildChatUrl } from "../../api/chat-jid";
import { normalizePost, mergeInteractions } from "./helpers";
import type { Interaction, TimelineResponse } from "./types";
import { fetchContiguousTimeline } from '../../../../../../src/ui/timeline-catch-up';

import { createLogger } from "../../utils/logger";
const log = createLogger("MessageList");


interface UseTimelineFetchParams {
  setConnected: (v: boolean) => void;
  scrollToBottom: (force?: boolean) => void;
  timelineError: Signal<string | null>;
  listRef: { current: HTMLDivElement | null };
}

/**
 * Manages timeline data: initial fetch, pagination (loadMore),
 * and reconnect refresh. Exposes message state and fetch utilities.
 */
export function useTimelineFetch({
  setConnected,
  scrollToBottom,
  timelineError,
  listRef,
}: UseTimelineFetchParams) {
  const [messages, setMessagesState] = useState<Interaction[]>([]);
  const mutationVersion = useRef(0);
  const setMessages = useCallback((update: Interaction[] | ((previous: Interaction[]) => Interaction[])) => {
    mutationVersion.current++;
    setMessagesState(update);
  }, []);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const initialTimelineFetchedRef = useRef(false);
  const messagesRef = useRef<Interaction[]>([]);
  const contiguousThroughId = useRef(0);
  const replaceMessages = useCallback((posts: Interaction[]) => {
    // Search/history replacement discards the segment that proved the old
    // boundary. This newly fetched page supplies its own verified endpoint.
    mutationVersion.current++;
    generation.current++;
    contiguousThroughId.current = Math.max(0, ...posts.map(post => Number(post.id) || 0));
    setMessagesState(posts);
  }, []);
  messagesRef.current = messages;
  const generation = useRef(0);
  const resumePending = useRef(false);
  const restoreAnchor = useRef<{ root: HTMLDivElement; top: number; height: number } | null>(null);
  const initialFollow = useRef(false);
  useLayoutEffect(() => {
    if (initialFollow.current) { initialFollow.current = false; scrollToBottom(true); }
    const anchor = restoreAnchor.current; restoreAnchor.current = null;
    if (anchor && listRef.current === anchor.root && anchor.root.isConnected) anchor.root.scrollTop = Math.min(0, anchor.top - (anchor.root.scrollHeight - anchor.height));
  }, [messages]);
  useEffect(() => () => { generation.current++; }, []);

  const fetchTimeline = useCallback(async () => {
    const res = await fetch(buildChatUrl("/timeline", { limit: "50" }), {
      credentials: "include",
    });
    if (res.status === 401) {
      setConnected(false);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      posts?: Array<Record<string, unknown>>;
      has_more?: boolean;
      identity?: { user_avatar_url?: string; assistant_avatar_url?: string };
    };
    // Populate global identity signals from timeline response
    if (data.identity) {
      const { userAvatarUrl: uav, assistantAvatarUrl: aav } = await import("../../api/identity");
      if (data.identity.user_avatar_url) uav.value = data.identity.user_avatar_url;
      if (data.identity.assistant_avatar_url) aav.value = data.identity.assistant_avatar_url;
    }
    if (!Array.isArray(data.posts)) throw Error('Invalid timeline page.');
    const posts = data.posts.map(normalizePost);
    return { posts, hasMore: data.has_more ?? false };
  }, [setConnected]);

  const refetchTimelineOnReconnect = useCallback(async (retried = false): Promise<void> => {
    const root = listRef.current;
    const beforeId = Math.max(0, ...messagesRef.current.map(row => Number(row.id) || 0));
    const capturedMessages = messagesRef.current;
    const capturedMutation = mutationVersion.current;
    const chatUrl = buildChatUrl('/timeline');
    const current = ++generation.current;
    const raw = await fetchContiguousTimeline(messagesRef.current, async (limit: number, before: number | null) => {
      const url = new URL(chatUrl, location.href); url.searchParams.set('limit', String(limit)); if (before !== null) url.searchParams.set('before', String(before));
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (!Array.isArray(result.posts)) throw Error('Invalid timeline page.');
      return { ...result, posts: result.posts.map(normalizePost) };
    }, () => current === generation.current && mutationVersion.current === capturedMutation && messagesRef.current === capturedMessages && buildChatUrl('/timeline') === chatUrl, contiguousThroughId.current);
    // A realtime arrival may invalidate a page started in the same event
    // turn. Retry once from the still-verified page boundary, never from that
    // isolated arrival's ID. Generation/chat guards still deny stale views.
    if (!raw && !retried && current === generation.current && buildChatUrl('/timeline') === chatUrl && listRef.current === root) {
      return refetchTimelineOnReconnect(true);
    }
    const timeline = raw ? { posts: (raw.posts as Interaction[]).slice().sort((a,b) => a.id - b.id), hasMore: raw.has_more } : null;
    if (!timeline || listRef.current !== root) return;
    contiguousThroughId.current = Math.max(0, ...timeline.posts.map(post => Number(post.id) || 0));
    // Capture at publication, not request start: the reader may have moved
    // while the network pages were in flight.
    const atLatest = !root || Math.abs(root.scrollTop) < 60;
    const beforeTop = root?.scrollTop ?? 0, beforeHeight = root?.scrollHeight ?? 0;
    if (root && !atLatest) restoreAnchor.current = { root, top: beforeTop, height: beforeHeight };
    setMessagesState(timeline.posts);
    setHasMore(timeline.hasMore);
    timelineError.value = null;
    if (atLatest) scrollToBottom(true);
    // Ensure scroll after DOM paint
    requestAnimationFrame(() => {
      if (listRef.current !== root || !root?.isConnected) return;
      if (atLatest && Math.abs(root.scrollTop) < 60) scrollToBottom(true);
      if (!atLatest && Math.max(0, ...timeline.posts.map(row => Number(row.id) || 0)) > beforeId) root.dispatchEvent(new Event('piclaw:timeline-arrivals'));
    });
  }, [fetchTimeline, scrollToBottom, timelineError]);

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'hidden' || resumePending.current) return;
      resumePending.current = true;
      void refetchTimelineOnReconnect().catch(error => { log.warn('timeline resume failed:', error); timelineError.value = 'Could not refresh messages. Try again.'; })
        .finally(() => { resumePending.current = false; });
    };
    window.addEventListener('pageshow', resume); window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('pageshow', resume); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [refetchTimelineOnReconnect, timelineError]);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    const current = generation.current, chatUrl = buildChatUrl('/timeline');
    async function fetchInitialTimeline() {
      try {
        const timeline = await fetchTimeline();
        if (!timeline || cancelled || current !== generation.current || chatUrl !== buildChatUrl('/timeline')) return;
        initialFollow.current = true;
        contiguousThroughId.current = Math.max(0, ...timeline.posts.map(post => Number(post.id) || 0));
        setMessagesState((prev) => mergeInteractions(prev, timeline.posts));
        setHasMore(timeline.hasMore);
        timelineError.value = null;
        setConnected(true);
        initialTimelineFetchedRef.current = true;
      } catch {
        if (!cancelled) setConnected(false);
      }
    }
    fetchInitialTimeline();
    return () => { cancelled = true; initialFollow.current = false; };
  }, [fetchTimeline, scrollToBottom, setConnected, timelineError]);

  const loadMore = async () => {
    if (!messages.length || loadingMore) return;
    const oldestId = messages[0].id;
    const current = generation.current, chatUrl = buildChatUrl('/timeline');
    const capturedMessages = messagesRef.current;
    const capturedMutation = mutationVersion.current;
    setLoadingMore(true);
    try {
      const res = await fetch(
        buildChatUrl("/timeline", { limit: "50", before: String(oldestId) }),
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TimelineResponse = await res.json();
      if (current !== generation.current || capturedMutation !== mutationVersion.current || chatUrl !== buildChatUrl('/timeline') || capturedMessages !== messagesRef.current) return;
      const olderPosts = (data.posts ?? []).map(normalizePost);
      setHasMore(data.has_more ?? false);
      timelineError.value = null;
      if (olderPosts.length) {
        const el = listRef.current;
        const prevScrollTop = el?.scrollTop ?? 0;
        setMessagesState((prev) => mergeInteractions(olderPosts, prev));
        // Restore scroll position
        requestAnimationFrame(() => {
          if (el && listRef.current === el) {
            el.scrollTop = prevScrollTop;
          }
        });
      }
    } catch (err) {
      log.warn("loadMore failed:", err);
      timelineError.value = "Failed to load older messages. Try again.";
    } finally {
      setLoadingMore(false);
    }
  };

  return {
    messages,
    setMessages,
    replaceMessages,
    hasMore,
    loadingMore,
    fetchTimeline,
    loadMore,
    refetchTimelineOnReconnect,
  };
}
