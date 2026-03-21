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
    };
}

export function hasEpisodeSpan(episodes, messageStart, messageEnd) {
    return (episodes || []).some(
        episode => Number(episode?.messageStart) === Number(messageStart)
            && Number(episode?.messageEnd) === Number(messageEnd),
    );
}
