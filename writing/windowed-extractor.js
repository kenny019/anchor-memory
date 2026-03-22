import { extractStateUpdates } from './extract-state.js';

export function extractStateWindowed({
    recentMessages = [],
    chatState = {},
    windowSize = 8,
    overlap = 3,
} = {}) {
    if (recentMessages.length <= windowSize) {
        return extractStateUpdates({ chatState, recentMessages });
    }

    const windows = partitionWindows(recentMessages, windowSize, overlap);
    const results = windows.map(window => extractStateUpdates({
        chatState,
        recentMessages: window,
    }));

    return mergeWindowResults(results, chatState?.sceneCard);
}

export function partitionWindows(messages, size, overlap) {
    const step = Math.max(1, size - overlap);
    const windows = [];

    for (let start = 0; start < messages.length; start += step) {
        const end = Math.min(start + size, messages.length);
        windows.push(messages.slice(start, end));
        if (end >= messages.length) break;
    }

    return windows;
}

export function mergeWindowResults(results, existingSceneCard = null) {
    const scalarFields = ['location', 'timeContext', 'activeGoal', 'activeConflict'];
    const merged = {};

    for (const field of scalarFields) {
        const extracted = results
            .map(result => result[field] || '')
            .filter(Boolean);

        if (extracted.length >= 2) {
            merged[field] = extracted[extracted.length - 1];
        } else if (extracted.length === 1) {
            const existing = existingSceneCard?.[field] || '';
            merged[field] = existing ? '' : extracted[0];
        } else {
            merged[field] = '';
        }
    }

    merged.openThreads = uniqueValues(results.flatMap(r => r.openThreads || []), 8);
    merged.participants = uniqueValues(results.flatMap(r => r.participants || []), 8);

    return merged;
}

function uniqueValues(values, limit) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const key = String(value || '').toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(String(value).trim());
        if (result.length >= limit) break;
    }
    return result;
}
