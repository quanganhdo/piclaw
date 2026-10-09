import { dedupePosts } from './timeline-utils.js';
/** Load contiguous newest-first pages before retaining an older cached suffix.
 * A bounded catch-up that cannot join it drops disconnected cached rows. */
export async function fetchContiguousTimeline(currentPosts, fetchPage, isCurrent = () => true, contiguousThroughId?: number) {
    // Without a verified page boundary, isolated SSE IDs cannot prove a join.
    // Conservatively page through the oldest retained row instead.
    const cachedIds = (Array.isArray(currentPosts) ? currentPosts : []).map(post => Number(post.id)).filter(id => Number.isFinite(id) && id > 0);
    const latestCached = contiguousThroughId && contiguousThroughId > 0 ? contiguousThroughId : (cachedIds.length ? Math.min(...cachedIds) : 0);
    let fresh = [], before = null, hasMore = false, joined = !latestCached;
    for (let page = 0; page < 10; page++) {
        const result = await fetchPage(50, before);
        if (!isCurrent()) return null;
        if (!Array.isArray(result?.posts)) throw Error('Invalid timeline page.');
        const rows = result.posts;
        fresh = dedupePosts([...fresh, ...rows]); hasMore = Boolean(result?.has_more);
        const oldest = Math.min(...rows.map(row => Number(row.id)).filter(Number.isFinite));
        joined = !latestCached || oldest <= latestCached;
        if (joined || !hasMore || !rows.length || !Number.isFinite(oldest) || before === oldest) break;
        before = oldest;
    }
    if (joined && fresh.length) {
        const minFresh = Math.min(...fresh.map(post => Number(post.id)).filter(Number.isFinite));
        fresh = dedupePosts([...fresh, ...(currentPosts || []).filter(post => Number(post.id) < minFresh)]);
    }
    return { posts: fresh, has_more: hasMore };
}
