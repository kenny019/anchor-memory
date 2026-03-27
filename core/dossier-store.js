import { getCached, setCached, COL_DOSSIERS } from './localforage-store.js';
import { normalizeDossierKey, normalizeDossier, mergeDossier } from '../models/dossiers.js';

const MAX_CHARACTERS = 15;
const MAX_ACTIVE_DOSSIERS = 8;

export function getAllDossiers(chatId) {
    return getCached(chatId, COL_DOSSIERS) || {};
}

export function getDossier(chatId, name) {
    const key = normalizeDossierKey(name);
    if (!key) return null;
    return getAllDossiers(chatId)[key] || null;
}

export function saveDossier(chatId, name, dossier) {
    const key = normalizeDossierKey(name);
    if (!key) return;
    const all = { ...getAllDossiers(chatId) };
    all[key] = normalizeDossier(dossier);
    setCached(chatId, COL_DOSSIERS, all);
}

export function deleteDossier(chatId, name) {
    const key = normalizeDossierKey(name);
    if (!key) return;
    const all = { ...getAllDossiers(chatId) };
    delete all[key];
    setCached(chatId, COL_DOSSIERS, all);
}

const SKIP_NAMES = new Set(['narrator', 'system'].map(normalizeDossierKey));

export function getActiveDossiers(chatId, participantNames = [], { currentMessageId = 0 } = {}) {
    const all = getAllDossiers(chatId);
    const keys = participantNames.map(normalizeDossierKey).filter(Boolean);
    const included = new Set();
    const result = [];

    // Priority: participants with dossiers (skip meta-names)
    for (const key of keys) {
        if (SKIP_NAMES.has(key)) continue;
        if (all[key]) {
            result.push(all[key]);
            included.add(key);
        }
        if (result.length >= MAX_ACTIVE_DOSSIERS) return result;
    }

    // Fill: recently-seen dossiers not already included
    if (currentMessageId > 0 && result.length < 8) {
        const recencyThreshold = currentMessageId - 20;
        const recent = Object.entries(all)
            .filter(([key, d]) => !included.has(key) && !SKIP_NAMES.has(key) && d.lastSeenMessageId >= recencyThreshold)
            .sort((a, b) => b[1].lastSeenMessageId - a[1].lastSeenMessageId);
        for (const [, dossier] of recent) {
            result.push(dossier);
            if (result.length >= MAX_ACTIVE_DOSSIERS) break;
        }
    }

    return result;
}

export function applyCharacterDeltas(chatId, deltas, meta = {}) {
    if (!Array.isArray(deltas) || deltas.length === 0) return;
    const all = { ...getAllDossiers(chatId) };
    let count = Object.keys(all).length;

    for (const delta of deltas) {
        const name = String(delta?.name || '').trim();
        if (!name) continue;
        const key = normalizeDossierKey(name);
        if (!key || SKIP_NAMES.has(key)) continue;

        const existing = all[key];
        if (!existing && count >= MAX_CHARACTERS) continue;

        all[key] = mergeDossier(existing || { name }, delta, meta);
        if (!existing) count++;
    }

    setCached(chatId, COL_DOSSIERS, all);
}
