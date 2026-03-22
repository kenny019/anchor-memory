export const EPISODE_TYPE = { EPISODE: 'episode', SEMANTIC: 'semantic' };

export function episodeStats(episodes) {
    let active = 0, archived = 0, semantic = 0;
    for (const ep of episodes || []) {
        if (ep.archived) archived++;
        else active++;
        if (ep.type === EPISODE_TYPE.SEMANTIC) semantic++;
    }
    return { active, archived, semantic };
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
    type = 'episode',
    sourceEpisodeIds = [],
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
    });
}

export function normalizeEpisode(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const significance = Math.max(1, Math.min(5, Number(raw.significance) || 2));
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
    };
}

export function hasEpisodeSpan(episodes, messageStart, messageEnd) {
    return (episodes || []).some(
        episode => Number(episode?.messageStart) === Number(messageStart)
            && Number(episode?.messageEnd) === Number(messageEnd),
    );
}
