import { getContext } from '../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { getActiveChatId, getChatState, saveChatState, persistNow } from '../core/storage.js';
import { isMemoryConfigured } from '../core/memory-config.js';
import { applyCharacterDeltas } from '../core/dossier-store.js';
import {
    normalizeChatMessages,
    getLatestAssistantMessage,
    buildTurnKey,
    buildLegacyTurnKey,
    resolveStoredMessageId,
    resolveStoredSpan,
} from '../core/messages.js';
import { createEpisode, hasEpisodeSpan, capActiveEpisodes, pruneArchivedEpisodes } from '../models/episodes.js';
import { hasSceneCardContent, mergeSceneCard } from '../models/state-cards.js';
import { llmExtractScene } from '../writing/llm-extract-state.js';
import { buildLLMEpisodeSummary } from '../writing/llm-summarizer.js';
import { consolidateEpisodes, applyConsolidation } from '../writing/consolidate-episodes.js';
import { createLLMCaller } from '../llm/api.js';

export async function processCompletedTurn({
    chatState = null,
    recentMessages = [],
    latestAssistantMessage = null,
    settings = {},
    type = 'normal',
} = {}) {
    const resolvedSettings = Object.keys(settings).length > 0 ? settings : getSettings();
    if (!resolvedSettings.enabled || type !== 'normal' || !isMemoryConfigured(resolvedSettings)) {
        return {
            episodeCandidate: null,
            safeUpdates: [],
        };
    }

    const context = getContext();
    const chatId = getActiveChatId();
    const resolvedChatState = chatState || getChatState(chatId);
    const normalizedMessages = recentMessages.length > 0
        ? recentMessages
        : normalizeChatMessages(context.chat, context);
    const finalAssistantMessage = latestAssistantMessage || getLatestAssistantMessage(normalizedMessages);

    if (!finalAssistantMessage) {
        return {
            episodeCandidate: null,
            safeUpdates: [],
        };
    }

    const canonicalChatState = canonicalizeChatStateForMessages(resolvedChatState, normalizedMessages);
    const turnKey = buildTurnKey(finalAssistantMessage);
    const legacyTurnKey = buildLegacyTurnKey(finalAssistantMessage);
    if (canonicalChatState.lastProcessedTurnKey === turnKey || canonicalChatState.lastProcessedTurnKey === legacyTurnKey) {
        return {
            episodeCandidate: null,
            safeUpdates: [],
        };
    }

    const llmCallFn = createLLMCaller(resolvedSettings);
    const sceneUpdate = await llmExtractScene({
        recentMessages: normalizedMessages,
        chatState: canonicalChatState,
        llmCallFn,
    });
    if (!sceneUpdate) {
        console.warn('[AnchorMemory] Scene extraction failed; skipping memory write for this turn');
        return {
            episodeCandidate: null,
            safeUpdates: [],
        };
    }

    if (sceneUpdate.characters?.length > 0) {
        try {
            applyCharacterDeltas(chatId, sceneUpdate.characters, {
                messageId: finalAssistantMessage.id,
            });
        } catch (err) {
            console.warn('[AnchorMemory] Dossier update failed:', err?.message);
        }
    }

    const nextSceneCard = mergeSceneCard(
        canonicalChatState.sceneCard,
        sceneUpdate,
        {
            updatedAtMessageId: finalAssistantMessage.id,
            updatedAtTs: Date.now(),
            replaceThreads: true,
        },
    );

    const episodeResult = await buildEpisode({
        sceneUpdate,
        messages: normalizedMessages,
        chatState: canonicalChatState,
        sceneCard: nextSceneCard,
        llmCallFn,
    });
    if (!episodeResult.ok) {
        console.warn('[AnchorMemory] Episode summarization failed; skipping memory write for this turn');
        return {
            episodeCandidate: null,
            safeUpdates: [],
        };
    }
    const episodeCandidate = episodeResult.episodeCandidate;

    let nextState = {
        ...canonicalChatState,
        lastProcessedTurnKey: turnKey,
        sceneCard: nextSceneCard,
    };

    if (episodeCandidate && !hasEpisodeSpan(canonicalChatState.episodes, episodeCandidate.messageStart, episodeCandidate.messageEnd)) {
        nextState.episodes = capActiveEpisodes([...(canonicalChatState.episodes || []), episodeCandidate]);
        nextState.lastEpisodeBoundaryMessageId = episodeCandidate.messageEnd;

        const activeCount = nextState.episodes.filter(ep => !ep.archived).length;
        if (resolvedSettings.llmConsolidation && resolvedSettings.autoConsolidation
            && activeCount >= (Number(resolvedSettings.consolidationThreshold) || 60)) {
            nextState.pendingConsolidation = true;
        }
    }

    if (nextState.pendingConsolidation && resolvedSettings.llmConsolidation) {
        try {
            const maxAutoDepth = Number(resolvedSettings.maxAutoConsolidationDepth) || 1;
            const result = await consolidateEpisodes({
                chatState: nextState,
                llmCallFn: createLLMCaller(resolvedSettings),
                settings: resolvedSettings,
                maxDepth: maxAutoDepth,
            });
            if (result.archivedIds.length > 0) {
                nextState = applyConsolidation(nextState, result);
                console.info(`[AnchorMemory] Consolidated ${result.archivedIds.length} episodes into ${result.newEpisodes.length} semantic memories`);

                // Prune archived episodes beyond storageMaxArchived
                const maxArchived = Number(resolvedSettings.storageMaxArchived) || 200;
                nextState.episodes = pruneArchivedEpisodes(nextState.episodes, maxArchived);
            } else {
                nextState.pendingConsolidation = false;
            }
        } catch (error) {
            console.warn('[AnchorMemory] Auto-consolidation failed:', error?.message);
            nextState.pendingConsolidation = false;
        }
    }

    saveChatState(chatId, nextState);

    if (episodeCandidate) {
        Promise.all([
            persistNow(chatId, 'state'),
            sceneUpdate.characters?.length > 0 ? persistNow(chatId, 'dossiers') : null,
        ]).catch(() => { /* fail-open */ });
    }

    return {
        episodeCandidate,
        safeUpdates: hasSceneCardContent(nextSceneCard) ? [nextSceneCard] : [],
    };
}

/**
 * Prune archived episodes beyond maxArchived, protecting those referenced by active sourceEpisodeIds.
 */
async function buildEpisode({
    sceneUpdate,
    messages,
    chatState,
    sceneCard,
    llmCallFn,
}) {
    const lastBoundary = Number(chatState.lastEpisodeBoundaryMessageId ?? -1);
    const candidates = messages.filter(m => Number(m.id) > lastBoundary);
    let boundary = sceneUpdate?.boundary || null;
    if (candidates.length >= 25) {
        boundary = { shouldCreate: true, reason: 'forced', significance: 2, title: '' };
    }
    if (!boundary?.shouldCreate || candidates.length === 0) {
        return { ok: true, episodeCandidate: null };
    }

    const episodeSummary = await buildLLMEpisodeSummary(candidates, sceneCard, llmCallFn);
    if (!episodeSummary) {
        return { ok: false, episodeCandidate: null };
    }

    return {
        ok: true,
        episodeCandidate: createEpisode({
            messageStart: Number(candidates[0].id),
            messageEnd: Number(candidates[candidates.length - 1].id),
            participants: sceneCard.participants || [],
            locations: sceneCard.location ? [sceneCard.location] : [],
            ...episodeSummary,
        }),
    };
}

function canonicalizeChatStateForMessages(chatState, messages) {
    const lastEpisodeBoundaryMessageId = resolveStoredMessageId(chatState.lastEpisodeBoundaryMessageId, messages)
        ?? chatState.lastEpisodeBoundaryMessageId;
    const updatedAtMessageId = resolveStoredMessageId(chatState.sceneCard?.updatedAtMessageId, messages)
        ?? chatState.sceneCard?.updatedAtMessageId
        ?? 0;
    const episodes = (chatState.episodes || []).map(episode => {
        const span = resolveStoredSpan(episode, messages);
        if (!span) return episode;
        return {
            ...episode,
            messageStart: span.start,
            messageEnd: span.end,
        };
    });

    return {
        ...chatState,
        lastEpisodeBoundaryMessageId,
        sceneCard: {
            ...(chatState.sceneCard || {}),
            updatedAtMessageId,
        },
        episodes,
    };
}
