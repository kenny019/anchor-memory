import { getCached, setCached, COL_DOSSIERS } from './localforage-store.js';
import { normalizeDossierKey, normalizeDossier, mergeDossier } from '../models/dossiers.js';

const MAX_CHARACTERS = 15;

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

export function getActiveDossiers(chatId, participantNames = []) {
    const all = getAllDossiers(chatId);
    const keys = participantNames.map(normalizeDossierKey).filter(Boolean);
    const result = [];
    for (const key of keys) {
        if (all[key]) result.push(all[key]);
        if (result.length >= 8) break;
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
        if (!key) continue;

        const existing = all[key];
        if (!existing && count >= MAX_CHARACTERS) continue;

        all[key] = mergeDossier(existing || { name }, delta, meta);
        if (!existing) count++;
    }

    setCached(chatId, COL_DOSSIERS, all);
}
