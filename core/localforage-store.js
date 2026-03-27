/**
 * IndexedDB-backed storage via localforage with synchronous in-memory cache.
 * Two keys per chat: am:{chatId}:state, am:{chatId}:dossiers
 * Fail-open: silently no-ops when localforage unavailable.
 */

const DEBOUNCE_MS = 300;
export const COL_STATE = 'state';
export const COL_DOSSIERS = 'dossiers';
const COLLECTIONS = [COL_STATE, COL_DOSSIERS];

const cache = new Map();
const dirtyKeys = new Set();
const debounceTimers = new Map();

function getLocalforage() {
    try {
        return globalThis.SillyTavern?.libs?.localforage ?? null;
    } catch {
        return null;
    }
}

function fullKey(chatId, collection) {
    return `am:${chatId}:${collection}`;
}

export async function loadChat(chatId) {
    const lf = getLocalforage();
    if (!lf) return;
    for (const col of COLLECTIONS) {
        const key = fullKey(chatId, col);
        try {
            const value = await lf.getItem(key);
            cache.set(key, value ?? null);
        } catch {
            cache.set(key, null);
        }
    }
}

export function getCached(chatId, collection) {
    return cache.get(fullKey(chatId, collection)) ?? null;
}

export function setCached(chatId, collection, value) {
    const key = fullKey(chatId, collection);
    cache.set(key, value);
    dirtyKeys.add(key);
    schedulePersist(key);
}

function schedulePersist(key) {
    if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
    debounceTimers.set(key, setTimeout(() => {
        debounceTimers.delete(key);
        persistKey(key);
    }, DEBOUNCE_MS));
}

async function persistKey(key) {
    const lf = getLocalforage();
    if (!lf) {
        dirtyKeys.delete(key);
        return;
    }
    const value = cache.get(key);
    try {
        if (value == null) await lf.removeItem(key);
        else await lf.setItem(key, value);
        dirtyKeys.delete(key);
    } catch (err) {
        console.warn('[AnchorMemory] localforage persist failed:', key, err?.message);
    }
}

export async function persistNow(chatId, collection) {
    const key = fullKey(chatId, collection);
    if (debounceTimers.has(key)) {
        clearTimeout(debounceTimers.get(key));
        debounceTimers.delete(key);
    }
    await persistKey(key);
}

export async function persistAllDirty() {
    const promises = [];
    for (const key of dirtyKeys) {
        if (debounceTimers.has(key)) {
            clearTimeout(debounceTimers.get(key));
            debounceTimers.delete(key);
        }
        promises.push(persistKey(key));
    }
    await Promise.all(promises);
}

export async function clearChat(chatId) {
    const lf = getLocalforage();
    for (const col of COLLECTIONS) {
        const key = fullKey(chatId, col);
        cache.delete(key);
        dirtyKeys.delete(key);
        if (debounceTimers.has(key)) {
            clearTimeout(debounceTimers.get(key));
            debounceTimers.delete(key);
        }
        if (lf) {
            try { await lf.removeItem(key); } catch { /* fail-open */ }
        }
    }
}

export function invalidateCache(chatId) {
    if (!chatId) return;
    for (const col of COLLECTIONS) {
        cache.delete(fullKey(chatId, col));
    }
}

/** @internal — test-only: reset all module state */
export function _resetForTesting() {
    cache.clear();
    dirtyKeys.clear();
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();
}

// Best-effort flush on tab close. IndexedDB writes are async and may not complete
// before the page tears down — data written in the last debounce window (~300ms)
// could be lost on hard close. Critical writes use persistNow() directly.
if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('beforeunload', () => persistAllDirty());
}
