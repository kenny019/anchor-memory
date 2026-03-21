import { getContext } from '../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { getActiveChatId, getChatState, saveChatState } from '../core/storage.js';
import { hasEpisodeSpan } from '../models/episodes.js';
import { hasSceneCardContent, mergeSceneCard } from '../models/state-cards.js';
import { extractStateUpdates } from '../writing/extract-state.js';
import { buildEpisodeCandidate } from '../writing/build-episode.js';

export function processCompletedTurn({
    chatState = null,
    recentMessages = [],
    latestAssistantMessage = null,
    settings = {},
    type = 'normal',
} = {}) {
    const resolvedSettings = Object.keys(settings).length > 0 ? settings : getSettings();
    if (!resolvedSettings.enabled) {
        return {
            episodeCandidate: null,
            safeUpdates: [],
        };
    }

    const skippedTypes = new Set(['swipe', 'continue', 'appendFinal', 'first_message', 'command', 'extension']);
    if (type !== 'normal' || skippedTypes.has(type)) {
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

    const sceneUpdate = extractStateUpdates({
        chatState: resolvedChatState,
        recentMessages: normalizedMessages,
        latestAssistantMessage: finalAssistantMessage,
    });
    const nextSceneCard = mergeSceneCard(
        resolvedChatState.sceneCard,
        sceneUpdate,
        {
            updatedAtMessageId: finalAssistantMessage.id,
            updatedAtTs: Date.now(),
        },
    );

    const episodeCandidate = resolvedSettings.autoCreateEpisodes && type === 'normal'
        ? buildEpisodeCandidate({
            chatState: {
                ...resolvedChatState,
                sceneCard: nextSceneCard,
            },
            recentMessages: normalizedMessages,
            settings: resolvedSettings,
        })
        : null;

    const nextState = {
        ...resolvedChatState,
        lastProcessedTurnKey: turnKey,
        sceneCard: nextSceneCard,
    };

    if (episodeCandidate && !hasEpisodeSpan(resolvedChatState.episodes, episodeCandidate.messageStart, episodeCandidate.messageEnd)) {
        nextState.episodes = [...(resolvedChatState.episodes || []), episodeCandidate].slice(-100);
        nextState.lastEpisodeBoundaryMessageId = episodeCandidate.messageEnd;
    }

    saveChatState(chatId, nextState);

    return {
        episodeCandidate,
        safeUpdates: hasSceneCardContent(nextSceneCard) ? [nextSceneCard] : [],
    };
}

function findLatestAssistantMessage(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (!messages[index].isUser) {
            return messages[index];
        }
    }
    return null;
}

function hashText(text) {
    let hash = 0;
    const value = String(text || '');
    for (let index = 0; index < value.length; index++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}
