import { getContext } from '../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { getChatState, getActiveChatId } from '../core/storage.js';
import { buildQueryContext } from '../retrieval/query-builder.js';
import { scoreEpisodes } from '../retrieval/score-episodes.js';
import { scoreSceneCard } from '../retrieval/score-state.js';
import { selectMemoryItems } from '../retrieval/selector.js';
import { formatMemoryBlock } from '../retrieval/formatter.js';

const TOOL_NAME = 'recall_memory';
let isRegistered = false;

export function registerMemoryTool() {
    if (isRegistered) return;

    const context = getContext();
    if (typeof context?.registerFunctionTool !== 'function') {
        console.warn('[AnchorMemory] registerFunctionTool not available — memory tool disabled');
        return;
    }

    context.registerFunctionTool({
        name: TOOL_NAME,
        displayName: 'Recall Memory',
        description: 'Search character memories for relevant past events, locations, relationships, or details. Use when you need to remember something specific.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'What to search for in memory (e.g. "the fight at the tavern", "relationship with Elena")',
                },
            },
            required: ['query'],
        },
        action: handleRecallMemory,
        formatMessage: (params) => `Recalling: ${params.query}`,
    });

    isRegistered = true;
    console.info('[AnchorMemory] recall_memory tool registered');
}

export function unregisterMemoryTool() {
    if (!isRegistered) return;

    const context = getContext();
    if (typeof context?.unregisterFunctionTool === 'function') {
        context.unregisterFunctionTool(TOOL_NAME);
    }

    isRegistered = false;
    console.info('[AnchorMemory] recall_memory tool unregistered');
}

async function handleRecallMemory({ query }) {
    const settings = getSettings();
    const chatState = getChatState(getActiveChatId());

    const queryContext = buildQueryContext({
        recentMessages: [{ text: String(query || '') }],
        sceneCard: chatState?.sceneCard,
    });

    const includeArchived = settings.archivedSearchEnabled !== false;
    const archivedPenalty = Number(settings.archivedScorePenalty) || 0.5;

    const scoredSceneCard = scoreSceneCard(chatState?.sceneCard || null, queryContext);
    const scoredEpisodes = scoreEpisodes(chatState?.episodes || [], queryContext, {
        includeArchived,
        archivedPenalty,
    });
    const selected = selectMemoryItems({
        scoredEpisodes,
        scoredSceneCard,
        settings: {
            ...settings,
            maxEpisodesInjected: Math.max(5, Number(settings.maxEpisodesInjected) || 3),
            archivedMaxResults: includeArchived ? (Number(settings.archivedMaxResults) || 2) : 0,
        },
    });

    const memoryBlock = formatMemoryBlock({
        episodes: selected.episodes,
        maxChars: Number(settings.maxInjectedChars) || 4000,
        sceneCard: selected.sceneCard,
    });

    return memoryBlock || 'No relevant memories found.';
}
