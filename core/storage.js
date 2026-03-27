import { getContext } from '../../../../st-context.js';
import { normalizeEpisode } from '../models/episodes.js';
import { createSceneCard, normalizeSceneCard } from '../models/state-cards.js';
import { getCached, setCached, loadChat, persistNow, COL_STATE, COL_DOSSIERS } from './localforage-store.js';

const retrievalSnapshotStore = new Map();

export function createEmptyChatState(chatId = 'default-chat') {
    return {
        version: 2,
        chatId,
        lastProcessedTurnKey: '',
        lastEpisodeBoundaryMessageId: null,
        sceneCard: createSceneCard(),
        episodes: [],
        pendingConsolidation: false,
    };
}

export function normalizeChatState(raw, chatId = 'default-chat') {
    const migratedSceneCard = raw?.sceneCard
        || raw?.stateCards?.find?.(entry => entry?.kind === 'scene')
        || raw?.stateCards?.[0]
        || {};
    const base = {
        ...createEmptyChatState(chatId),
        ...(raw || {}),
    };

    base.sceneCard = normalizeSceneCard(migratedSceneCard?.fields ? {
        ...migratedSceneCard.fields,
        participants: migratedSceneCard.fields?.participants || migratedSceneCard.participants || [],
        openThreads: migratedSceneCard.fields?.openThreads || migratedSceneCard.openThreads || [],
    } : migratedSceneCard);
    base.episodes = Array.isArray(base.episodes)
        ? base.episodes.map(normalizeEpisode).filter(Boolean)
        : [];
    base.lastProcessedTurnKey = String(base.lastProcessedTurnKey || '');
    base.version = 2;
    base.pendingConsolidation = Boolean(base.pendingConsolidation);

    return base;
}

export function getActiveChatId() {
    const context = getContext();
    return context.chatId || context.getCurrentChatId?.() || 'default-chat';
}

export function ensureChatState(chatId = getActiveChatId()) {
    const current = getCached(chatId, COL_STATE);
    if (current) return normalizeChatState(current, chatId);
    const empty = createEmptyChatState(chatId);
    setCached(chatId, COL_STATE, empty);
    return empty;
}

export function getChatState(chatId = getActiveChatId()) {
    return normalizeChatState(getCached(chatId, COL_STATE), chatId);
}

export function saveChatState(chatId, chatState) {
    const normalized = normalizeChatState(chatState, chatId);
    setCached(chatId, COL_STATE, normalized);
    return normalized;
}

export function resetChatState(chatId = getActiveChatId()) {
    const empty = createEmptyChatState(chatId);
    setCached(chatId, COL_STATE, empty);
    setCached(chatId, COL_DOSSIERS, {});
    return empty;
}

export async function preloadChat(chatId) {
    await loadChat(chatId);
}

export { persistNow };

export function setRetrievalSnapshot(chatId, snapshot) {
    if (!snapshot) {
        retrievalSnapshotStore.delete(chatId);
        return;
    }
    retrievalSnapshotStore.set(chatId, snapshot);
}

export function getRetrievalSnapshot(chatId = getActiveChatId()) {
    return retrievalSnapshotStore.get(chatId) || null;
}

export function clearRetrievalSnapshot(chatId = getActiveChatId()) {
    retrievalSnapshotStore.delete(chatId);
}
