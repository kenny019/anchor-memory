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
