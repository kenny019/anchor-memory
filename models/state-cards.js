function toCleanString(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values, limit = Infinity) {
    const seen = new Set();
    const result = [];

    for (const value of values || []) {
        const normalized = toCleanString(value);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(normalized);
        if (result.length >= limit) break;
    }

    return result;
}

export function createSceneCard({
    location = '',
    timeContext = '',
    activeGoal = '',
    activeConflict = '',
    openThreads = [],
    participants = [],
    updatedAtMessageId = 0,
    updatedAtTs = Date.now(),
} = {}) {
    return normalizeSceneCard({
        location,
        timeContext,
        activeGoal,
        activeConflict,
        openThreads,
        participants,
        updatedAtMessageId,
        updatedAtTs,
    });
}

export function normalizeSceneCard(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            location: '',
            timeContext: '',
            activeGoal: '',
            activeConflict: '',
            openThreads: [],
            participants: [],
            updatedAtMessageId: 0,
            updatedAtTs: Date.now(),
        };
    }

    return {
        location: toCleanString(raw.location),
        timeContext: toCleanString(raw.timeContext),
        activeGoal: toCleanString(raw.activeGoal),
        activeConflict: toCleanString(raw.activeConflict),
        openThreads: uniqueStrings(raw.openThreads, 8),
        participants: uniqueStrings(raw.participants, 8),
        updatedAtMessageId: Number.isFinite(Number(raw.updatedAtMessageId)) ? Number(raw.updatedAtMessageId) : 0,
        updatedAtTs: Number.isFinite(Number(raw.updatedAtTs)) ? Number(raw.updatedAtTs) : Date.now(),
    };
}

export function hasSceneCardContent(sceneCard) {
    const normalized = normalizeSceneCard(sceneCard);
    return Boolean(
        normalized.location
        || normalized.timeContext
        || normalized.activeGoal
        || normalized.activeConflict
        || normalized.openThreads.length > 0
        || normalized.participants.length > 0
    );
}

export function mergeSceneCard(existingSceneCard, partialSceneCard, meta = {}) {
    const existing = normalizeSceneCard(existingSceneCard);
    const incoming = normalizeSceneCard(partialSceneCard);

    // LLM extraction replaces threads entirely (it sees enough context to know what's active).
    // Heuristic extraction merges to avoid losing threads from previous windows.
    const replaceThreads = Boolean(meta.replaceThreads);

    const merged = {
        location: incoming.location || existing.location,
        timeContext: incoming.timeContext || existing.timeContext,
        activeGoal: incoming.activeGoal || existing.activeGoal,
        activeConflict: incoming.activeConflict || existing.activeConflict,
        openThreads: incoming.openThreads.length > 0
            ? (replaceThreads ? uniqueStrings(incoming.openThreads, 8) : uniqueStrings([...incoming.openThreads, ...existing.openThreads], 8))
            : existing.openThreads,
        participants: incoming.participants.length > 0
            ? uniqueStrings(incoming.participants, 8)
            : existing.participants,
        updatedAtMessageId: Number.isFinite(Number(meta.updatedAtMessageId))
            ? Number(meta.updatedAtMessageId)
            : existing.updatedAtMessageId,
        updatedAtTs: Number.isFinite(Number(meta.updatedAtTs))
            ? Number(meta.updatedAtTs)
            : existing.updatedAtTs,
    };

    return normalizeSceneCard(merged);
}

export function getSceneCardLines(sceneCard) {
    const normalized = normalizeSceneCard(sceneCard);
    const lines = [];

    if (normalized.location) lines.push(`Location: ${normalized.location}`);
    if (normalized.timeContext) lines.push(`Time: ${normalized.timeContext}`);
    if (normalized.activeGoal) lines.push(`Goal: ${normalized.activeGoal}`);
    if (normalized.activeConflict) lines.push(`Conflict: ${normalized.activeConflict}`);
    if (normalized.participants.length > 0) lines.push(`Participants: ${normalized.participants.join(', ')}`);
    if (normalized.openThreads.length > 0) lines.push(`Open Threads: ${normalized.openThreads.join(' | ')}`);

    return lines;
}
