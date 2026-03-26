export const EPISODE_TYPE = { EPISODE: 'episode', SEMANTIC: 'semantic' };

export function episodeStats(episodes) {
    let active = 0, archived = 0;
    const byDepth = {};
    for (const ep of episodes || []) {
        if (ep.archived) archived++;
        else {
            active++;
            const d = ep.depth || 0;
            byDepth[d] = (byDepth[d] || 0) + 1;
        }
    }
    return { active, archived, byDepth };
}

export function getEpisodeDepth(ep) {
    return Number(ep?.depth) || 0;
}

export function maxDepthAmong(episodes) {
    let max = 0;
    for (const ep of episodes || []) {
        const d = getEpisodeDepth(ep);
        if (d > max) max = d;
    }
    return max;
}

export function createEpisode({
    id,
    messageStart = 0,
    messageEnd = 0,
    title = '',
    summary = '',
    participants = [],
    locations = [],
    tags = [],
    significance = 2,
    createdAtTs = Date.now(),
    pinned = false,
    archived = false,
    type = EPISODE_TYPE.EPISODE,
    sourceEpisodeIds = [],
    keyFacts = [],
    depth = 0,
} = {}) {
    return normalizeEpisode({
        id: id || `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        messageStart,
        messageEnd,
        title,
        summary,
        participants,
        locations,
        tags,
        significance,
        createdAtTs,
        pinned,
        archived,
        type,
        sourceEpisodeIds,
        keyFacts,
        depth,
    });
}

export function normalizeEpisode(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const significance = Math.max(1, Math.min(5, Number(raw.significance) || 2));

    // Backfill: existing semantic episodes without depth get depth 1
    let depth = Number(raw.depth) || 0;
    if (raw.type === EPISODE_TYPE.SEMANTIC && depth === 0) {
        depth = 1;
    }

    return {
        id: String(raw.id || `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        messageStart: Number.isFinite(Number(raw.messageStart)) ? Number(raw.messageStart) : 0,
        messageEnd: Number.isFinite(Number(raw.messageEnd)) ? Number(raw.messageEnd) : 0,
        title: String(raw.title || ''),
        summary: String(raw.summary || ''),
        participants: Array.isArray(raw.participants) ? raw.participants.map(String) : [],
        locations: Array.isArray(raw.locations) ? raw.locations.map(String) : [],
        tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
        significance,
        createdAtTs: Number.isFinite(Number(raw.createdAtTs)) ? Number(raw.createdAtTs) : Date.now(),
        pinned: Boolean(raw.pinned),
        archived: Boolean(raw.archived),
        type: raw.type === EPISODE_TYPE.SEMANTIC ? EPISODE_TYPE.SEMANTIC : EPISODE_TYPE.EPISODE,
        sourceEpisodeIds: Array.isArray(raw.sourceEpisodeIds) ? raw.sourceEpisodeIds.map(String) : [],
        keyFacts: Array.isArray(raw.keyFacts) ? raw.keyFacts.map(String) : [],
        depth,
    };
}

export function formatDepthInfo(byDepth) {
    return Object.entries(byDepth).map(([d, n]) => `${n} d${d}`).join(', ') || '0';
}

/**
 * Split episodes into archived/active, cap active at maxActive with depth-aware priority.
 */
export function capActiveEpisodes(episodes, maxActive = 100) {
    const archived = [];
    const active = [];
    for (const ep of episodes) {
        if (ep.archived) archived.push(ep);
        else active.push(ep);
    }
    const sorted = active.sort((a, b) => (b.depth || 0) - (a.depth || 0) || b.createdAtTs - a.createdAtTs);
    return [...archived, ...sorted.slice(0, maxActive)];
}

export function hasEpisodeSpan(episodes, messageStart, messageEnd) {
    return (episodes || []).some(
        episode => Number(episode?.messageStart) === Number(messageStart)
            && Number(episode?.messageEnd) === Number(messageEnd),
    );
}
