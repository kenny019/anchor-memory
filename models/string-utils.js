export function toCleanString(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

export function uniqueStrings(values, limit = Infinity) {
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

const NARRATOR_RE = /^(narrator|system)$/i;

export function isNarratorName(name) {
    return NARRATOR_RE.test(name);
}

export function isSubstantiveMessage(m) {
    const text = String(m.text || '').trim();
    return text.length > 0 && !/^\(continue\)$/i.test(text);
}
