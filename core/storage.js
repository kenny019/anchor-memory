import { getContext } from '../../../st-context.js';
import { saveMetadataDebounced } from '../../../extensions.js';
import { normalizeEpisode } from '../models/episodes.js';
import { createSceneCard, normalizeSceneCard } from '../models/state-cards.js';

export const CHAT_METADATA_KEY = 'anchor_memory';
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
    const context = getContext();
    const current = context.chatMetadata?.[CHAT_METADATA_KEY];
    const normalized = normalizeChatState(current, chatId);
    if (!context.chatMetadata[CHAT_METADATA_KEY]) {
        context.chatMetadata[CHAT_METADATA_KEY] = normalized;
        saveMetadataDebounced();
    }
    return normalized;
}

export function getChatState(chatId = getActiveChatId()) {
    const context = getContext();
    return normalizeChatState(context.chatMetadata?.[CHAT_METADATA_KEY], chatId);
}

export function saveChatState(chatId, chatState) {
    const context = getContext();
    const normalized = normalizeChatState(chatState, chatId);
    context.chatMetadata[CHAT_METADATA_KEY] = normalized;
    saveMetadataDebounced();
    return normalized;
}

export function resetChatState(chatId = getActiveChatId()) {
    const empty = createEmptyChatState(chatId);
    return saveChatState(chatId, empty);
}

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
