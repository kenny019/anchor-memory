import { getContext } from '../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { getActiveChatId, getChatState, saveChatState } from '../core/storage.js';
import { hasEpisodeSpan, EPISODE_TYPE } from '../models/episodes.js';
import { hasSceneCardContent, mergeSceneCard } from '../models/state-cards.js';
import { extractStateUpdates } from '../writing/extract-state.js';
import { extractStateWindowed } from '../writing/windowed-extractor.js';
import { llmExtractScene } from '../writing/llm-extract-state.js';
import { buildEpisodeCandidate } from '../writing/build-episode.js';
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
    if (!resolvedSettings.enabled || type !== 'normal') {
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
        : context.chat.map((message, index) => ({
            id: index,
            isUser: Boolean(message.is_user),
            isSystem: Boolean(message.is_system),
            name: String(message.name || (message.is_user ? context.name1 : context.name2) || ''),
            text: String(message.mes || ''),
        })).filter(message => !message.isSystem);
    const finalAssistantMessage = latestAssistantMessage || findLatestAssistantMessage(normalizedMessages);

    if (!finalAssistantMessage) {
        return {
            episodeCandidate: null,
            safeUpdates: [],
        };
    }

    const turnKey = `${finalAssistantMessage.id}:${hashText(finalAssistantMessage.text)}:normal`;
    if (resolvedChatState.lastProcessedTurnKey === turnKey) {
        return {
            episodeCandidate: null,
            safeUpdates: [],
        };
    }

    const useLLMExtraction = Boolean(resolvedSettings.memoryModelSource && resolvedSettings.memoryModel);
    const sceneUpdate = await extractSceneState(useLLMExtraction, normalizedMessages, resolvedChatState, resolvedSettings, finalAssistantMessage);
    const nextSceneCard = mergeSceneCard(
        resolvedChatState.sceneCard,
        sceneUpdate,
        {
            updatedAtMessageId: finalAssistantMessage.id,
            updatedAtTs: Date.now(),
            replaceThreads: useLLMExtraction,
        },
    );

    const episodeCandidate = resolvedSettings.autoCreateEpisodes && type === 'normal'
        ? await buildEpisodeCandidate({
            chatState: {
                ...resolvedChatState,
                sceneCard: nextSceneCard,
            },
            recentMessages: normalizedMessages,
            settings: resolvedSettings,
            llmCallFn: resolvedSettings.llmSummarization ? createLLMCaller(resolvedSettings) : null,
        })
        : null;

    let nextState = {
        ...resolvedChatState,
        lastProcessedTurnKey: turnKey,
        sceneCard: nextSceneCard,
    };

    if (episodeCandidate && !hasEpisodeSpan(resolvedChatState.episodes, episodeCandidate.messageStart, episodeCandidate.messageEnd)) {
        const allEpisodes = [...(resolvedChatState.episodes || []), episodeCandidate];
        const archived = [];
        const active = [];
        let eligibleCount = 0;
        for (const ep of allEpisodes) {
            if (ep.archived) {
                archived.push(ep);
            } else {
                active.push(ep);
                if (ep.type !== EPISODE_TYPE.SEMANTIC) eligibleCount++;
            }
        }
        nextState.episodes = [...archived, ...active.slice(-100)];
        nextState.lastEpisodeBoundaryMessageId = episodeCandidate.messageEnd;

        if (resolvedSettings.llmConsolidation && resolvedSettings.autoConsolidation
            && eligibleCount >= (Number(resolvedSettings.consolidationThreshold) || 60)) {
            nextState.pendingConsolidation = true;
        }
    }

    if (nextState.pendingConsolidation && resolvedSettings.llmConsolidation) {
        try {
            const result = await consolidateEpisodes({ chatState: nextState, llmCallFn: createLLMCaller(resolvedSettings) });
            if (result.archivedIds.length > 0) {
                nextState = applyConsolidation(nextState, result);
                console.info(`[AnchorMemory] Consolidated ${result.archivedIds.length} episodes into ${result.newEpisodes.length} semantic memories`);
            } else {
                nextState.pendingConsolidation = false;
            }
        } catch (error) {
            console.warn('[AnchorMemory] Auto-consolidation failed:', error?.message);
            nextState.pendingConsolidation = false;
        }
    }

    saveChatState(chatId, nextState);

    return {
        episodeCandidate,
        safeUpdates: hasSceneCardContent(nextSceneCard) ? [nextSceneCard] : [],
    };
}

async function extractSceneState(useLLM, messages, chatState, settings, latestAssistantMessage) {
    if (useLLM) {
        const result = await llmExtractScene({ recentMessages: messages, chatState, llmCallFn: createLLMCaller(settings) });
        if (result) return result;
        console.warn('[AnchorMemory] LLM extraction failed, falling back to heuristic');
    }
    if (settings.windowedExtraction) {
        return extractStateWindowed({
            recentMessages: messages,
            chatState,
            windowSize: Number(settings.extractionWindowSize) || 8,
            overlap: Number(settings.extractionWindowOverlap) || 3,
        });
    }
    return extractStateUpdates({ chatState, recentMessages: messages, latestAssistantMessage });
}

function findLatestAssistantMessage(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (!messages[index].isUser) {
            return messages[index];
        }
    }
    return null;
}

export function hashText(text) {
    let hash = 0;
    const value = String(text || '');
    for (let index = 0; index < value.length; index++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}
