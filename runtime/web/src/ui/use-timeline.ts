import { useCallback, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { getTimeline, getPostsByHashtag } from '../api.js';
import { cacheTimelineSnapshot, getCachedTimelineSnapshot } from './app-timeline-cache.js';
import { fetchContiguousTimeline } from './timeline-catch-up.js';
export { fetchContiguousTimeline } from './timeline-catch-up.js';
import { dedupePosts } from './timeline-utils.js';

export function isTimelineRequestCurrent({
  requestId,
  currentRequestId,
  mutationVersion,
  currentMutationVersion,
  chatToken,
  currentChatToken,
}) {
  return requestId === currentRequestId
    && mutationVersion === currentMutationVersion
    && chatToken === currentChatToken;
}

export function mergeFreshTimelinePosts(currentPosts, freshPosts) {
  const currentArray = Array.isArray(currentPosts) ? currentPosts : [];
  const freshArray = Array.isArray(freshPosts) ? freshPosts : null;
  if (!freshArray) return currentArray;
  if (freshArray.length === 0) return freshArray;
  if (currentArray.length === 0) return freshArray;
  // Window-replace merge: fresh is authoritative for its own id range.
  // Drop cached rows whose id falls within the fresh window (>= minFreshId)
  // so a row that disappeared server-side (deleted elsewhere, branch reset)
  // does not survive as a phantom; keep older cached rows (id < minFreshId)
  // that were loaded via loadMore.
  let minFreshId = Infinity;
  for (const post of freshArray) {
    const id = post?.id;
    if (typeof id === 'number' && Number.isFinite(id) && id < minFreshId) {
      minFreshId = id;
    }
  }
  if (!Number.isFinite(minFreshId)) {
    return dedupePosts([...freshArray, ...currentArray]);
  }
  const olderCached = currentArray.filter((post) => {
    const id = post?.id;
    return typeof id === 'number' && Number.isFinite(id) && id < minFreshId;
  });
  return dedupePosts([...freshArray, ...olderCached]);
}

export function useTimeline({ preserveTimelineScroll, preserveTimelineScrollTop, chatJid = null, currentHashtag = null, searchQuery = null }) {
  const [posts, setPostsState] = useState(null);
  const [hasMore, setHasMoreState] = useState(false);
  const hasMoreRef = useRef(false);
  const loadMoreRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const lastBeforeIdRef = useRef(null);
  const postsRef = useRef(null);
  const contiguousThroughIdRef = useRef(0);
  const chatTokenRef = useRef(0);
  const mutationVersionRef = useRef(0);
  const refreshRequestRef = useRef(0);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  const shouldCacheCurrentView = !currentHashtag && !searchQuery;
  // Mirror the current view-mode in a ref so async callbacks (cache-hit
  // background refresh) can bail out if the user has switched into hashtag
  // or search mode, which does not bump chatTokenRef.
  const viewModeCacheableRef = useRef(shouldCacheCurrentView);
  useEffect(() => {
    viewModeCacheableRef.current = shouldCacheCurrentView;
  }, [shouldCacheCurrentView]);

  useEffect(() => {
    chatTokenRef.current += 1;
    // Clear stale posts immediately when switching sessions so
    // refreshTimeline (merge-based) never mixes posts from two
    // different chat_jid timelines.
    setPostsState(null);
    postsRef.current = null;
    contiguousThroughIdRef.current = 0;
    lastBeforeIdRef.current = null;
    loadingMoreRef.current = false;
    hasMoreRef.current = false;
    setHasMoreState(false);
    mutationVersionRef.current = 0;
    refreshRequestRef.current += 1;
  }, [chatJid]);

  const cacheCurrentSnapshot = useCallback((nextPosts, nextHasMore) => {
    if (!shouldCacheCurrentView) return;
    cacheTimelineSnapshot(chatJid, {
      posts: Array.isArray(nextPosts) ? nextPosts : [],
      has_more: Boolean(nextHasMore),
      contiguousThroughId: contiguousThroughIdRef.current,
    });
  }, [chatJid, shouldCacheCurrentView]);

  const setTimelineState = useCallback((nextPosts, nextHasMore) => {
    mutationVersionRef.current += 1;
    postsRef.current = Array.isArray(nextPosts) ? nextPosts : [];
    hasMoreRef.current = Boolean(nextHasMore);
    setPostsState(postsRef.current);
    setHasMoreState(hasMoreRef.current);
    cacheCurrentSnapshot(postsRef.current, hasMoreRef.current);
  }, [cacheCurrentSnapshot]);

  const loadPosts = useCallback(async (hashtag = null) => {
    const token = chatTokenRef.current;
    const mutationVersion = mutationVersionRef.current;
    const requestId = ++refreshRequestRef.current;
    try {
      if (hashtag) {
        const result = await getPostsByHashtag(hashtag, 50, 0, chatJid);
        if (token !== chatTokenRef.current || mutationVersion !== mutationVersionRef.current || requestId !== refreshRequestRef.current) return;
        mutationVersionRef.current += 1;
        postsRef.current = Array.isArray(result?.posts) ? result.posts : [];
        hasMoreRef.current = false;
        setPostsState(postsRef.current);
        setHasMoreState(false);
        return;
      }

      const applyFreshPayload = (result) => {
        if (token !== chatTokenRef.current || mutationVersion !== mutationVersionRef.current || requestId !== refreshRequestRef.current) return;
        const nextPosts = Array.isArray(result?.posts) ? result.posts : [];
        const nextHasMore = Boolean(result?.has_more);
        contiguousThroughIdRef.current = Math.max(0, ...nextPosts.map(post => Number(post.id) || 0));
        setTimelineState(nextPosts, nextHasMore);
      };

      const cached = getCachedTimelineSnapshot(chatJid);
      if (cached) {
        contiguousThroughIdRef.current = cached.contiguousThroughId;
        setTimelineState(cached.posts, cached.has_more);
        const backgroundMutationVersion = mutationVersionRef.current;
        void fetchContiguousTimeline(cached.posts, (limit, before) => getTimeline(limit, before, chatJid),
          () => token === chatTokenRef.current && requestId === refreshRequestRef.current && mutationVersionRef.current === backgroundMutationVersion && viewModeCacheableRef.current, cached.contiguousThroughId)
          .then((result) => {
            if (token !== chatTokenRef.current || requestId !== refreshRequestRef.current || mutationVersionRef.current !== backgroundMutationVersion) return;
            // Drop the refresh if the user has switched into hashtag/search
            // mode since the request was kicked off — chatTokenRef does not
            // change across in-chat view-mode transitions, so it would not
            // otherwise invalidate this callback.
            if (!viewModeCacheableRef.current) return;
            if (!result) return;
            const freshPosts = Array.isArray(result?.posts) ? result.posts : [];
            const freshHasMore = Boolean(result?.has_more);
            contiguousThroughIdRef.current = Math.max(0, ...freshPosts.map(post => Number(post.id) || 0));
            setTimelineState(freshPosts, freshHasMore);
          })
          .catch((error) => {
            if (token !== chatTokenRef.current) return;
            console.error('Failed to refresh cached timeline:', error);
          });
        return;
      }

      const result = await getTimeline(50, null, chatJid);
      applyFreshPayload(result);
    } catch (error) {
      if (token !== chatTokenRef.current) return;
      console.error('Failed to load posts:', error);
      throw error;
    }
  }, [chatJid, setTimelineState]);

  const refreshTimeline = useCallback(async (retried = false) => {
    const token = chatTokenRef.current;
    const mutationVersion = mutationVersionRef.current;
    const requestId = ++refreshRequestRef.current;
    try {
      const result = await fetchContiguousTimeline(postsRef.current, (limit, before) => getTimeline(limit, before, chatJid),
        () => isTimelineRequestCurrent({ requestId, currentRequestId: refreshRequestRef.current, mutationVersion, currentMutationVersion: mutationVersionRef.current, chatToken: token, currentChatToken: chatTokenRef.current }), contiguousThroughIdRef.current);
      if (!result) {
        if (!retried && token === chatTokenRef.current && requestId === refreshRequestRef.current && viewModeCacheableRef.current) return refreshTimeline(true);
        return;
      }
      if (!isTimelineRequestCurrent({
        requestId,
        currentRequestId: refreshRequestRef.current,
        mutationVersion,
        currentMutationVersion: mutationVersionRef.current,
        chatToken: token,
        currentChatToken: chatTokenRef.current,
      })) return;
      contiguousThroughIdRef.current = Math.max(0, ...result.posts.map(post => Number(post.id) || 0));
      setTimelineState(result.posts, Boolean(result?.has_more));
    } catch (error) {
      if (token !== chatTokenRef.current) return;
      console.error('Failed to refresh timeline:', error);
    }
  }, [chatJid, setTimelineState]);

  // loadMore reads posts from ref to avoid re-creating on every posts change.
  const loadMore = useCallback(async (options = {}) => {
    const token = chatTokenRef.current;
    const currentPosts = postsRef.current;
    const mutationVersion = mutationVersionRef.current;
    if (!currentPosts || currentPosts.length === 0) return;
    if (loadingMoreRef.current) return;
    const { preserveScroll = true, preserveMode = 'top', allowRepeat = false } = options;
    const applyUpdate = (fn) => {
      if (!preserveScroll) {
        fn();
        return;
      }
      if (preserveMode === 'top') preserveTimelineScrollTop(fn);
      else preserveTimelineScroll(fn);
    };
    const sortedPosts = currentPosts.slice().sort((a, b) => a.id - b.id);
    const oldestId = sortedPosts[0]?.id;
    if (!Number.isFinite(oldestId)) return;
    if (!allowRepeat && lastBeforeIdRef.current === oldestId) return;

    loadingMoreRef.current = true;
    lastBeforeIdRef.current = oldestId;
    try {
      const result = await getTimeline(10, oldestId, chatJid);
      if (token !== chatTokenRef.current) return;
      if (mutationVersion !== mutationVersionRef.current) { lastBeforeIdRef.current = null; return; }
      if (result.posts.length > 0) {
        applyUpdate(() => {
          const nextPosts = dedupePosts([...result.posts, ...(postsRef.current || [])]);
          setTimelineState(nextPosts, result.has_more);
        });
      } else {
        setTimelineState(postsRef.current || [], false);
      }
    } catch (error) {
      if (token !== chatTokenRef.current) return;
      lastBeforeIdRef.current = null;
      console.error('Failed to load more posts:', error);
      throw error;
    } finally {
      if (token === chatTokenRef.current) {
        loadingMoreRef.current = false;
      }
    }
  }, [chatJid, preserveTimelineScroll, preserveTimelineScrollTop, setTimelineState]);

  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

  const setPosts = useCallback((updater) => {
    // Invalidate in-flight refreshes synchronously. State updater callbacks may
    // run on a later render, which is too late for view switches and realtime
    // final responses racing an already-resolved timeline request.
    mutationVersionRef.current += 1;
    // Search/context replacement discards the page that proved the prior
    // endpoint. Individual functional SSE edits retain, never advance, it.
    if (typeof updater !== 'function') contiguousThroughIdRef.current = 0;
    setPostsState((prev) => {
      const nextPosts = typeof updater === 'function' ? updater(prev) : updater;
      postsRef.current = nextPosts;
      if (Array.isArray(nextPosts)) {
        // Persist even the empty snapshot: deleting the last visible row must
        // invalidate the prior cached state, otherwise a quick switch-away
        // and back within the TTL would resurrect rows we just removed.
        if (shouldCacheCurrentView) {
          cacheTimelineSnapshot(chatJid, {
            posts: nextPosts,
            has_more: hasMoreRef.current,
            contiguousThroughId: contiguousThroughIdRef.current,
          });
        }
      }
      return nextPosts;
    });
  }, [chatJid, shouldCacheCurrentView]);

  return {
    posts,
    setPosts,
    hasMore,
    setHasMore: setHasMoreState,
    hasMoreRef,
    loadPosts,
    refreshTimeline,
    loadMore,
    loadMoreRef,
    loadingMoreRef,
    lastBeforeIdRef,
  };
}
