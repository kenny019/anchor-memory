import { toCleanString, uniqueStrings } from './string-utils.js';

export function normalizeDossierKey(name) {
    return String(name || '').toLowerCase().trim();
}

export function createDossier(fields = {}) {
    return normalizeDossier(fields);
}

export function normalizeDossier(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            name: '',
            aliases: [],
            relationship: '',
            emotionalState: '',
            knownInfo: [],
            goals: '',
            traits: [],
            lastSeenMessageId: 0,
            updatedAtTs: Date.now(),
        };
    }
    return {
        name: toCleanString(raw.name),
        aliases: uniqueStrings(raw.aliases, 5),
        relationship: toCleanString(raw.relationship),
        emotionalState: toCleanString(raw.emotionalState),
        knownInfo: uniqueStrings(raw.knownInfo, 15),
        goals: toCleanString(raw.goals),
        traits: uniqueStrings(raw.traits, 8),
        lastSeenMessageId: Number.isFinite(Number(raw.lastSeenMessageId)) ? Number(raw.lastSeenMessageId) : 0,
        updatedAtTs: Number.isFinite(Number(raw.updatedAtTs)) ? Number(raw.updatedAtTs) : Date.now(),
    };
}

export function mergeDossier(existing, incoming, meta = {}) {
    const base = normalizeDossier(existing);
    const update = normalizeDossier(incoming);
    return normalizeDossier({
        name: update.name || base.name,
        aliases: [...base.aliases, ...update.aliases],
        relationship: update.relationship || base.relationship,
        emotionalState: update.emotionalState || base.emotionalState,
        knownInfo: [...base.knownInfo, ...update.knownInfo],
        goals: update.goals || base.goals,
        traits: [...base.traits, ...update.traits],
        lastSeenMessageId: Number.isFinite(Number(meta.messageId)) ? Number(meta.messageId) : base.lastSeenMessageId,
        updatedAtTs: Date.now(),
    });
}
