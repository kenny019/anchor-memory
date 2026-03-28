import { getContext } from '../../../../st-context.js';
import { getSettings, DEFAULT_CANDIDATE_COUNT } from '../core/settings.js';
import { getMemoryInactiveReason, isMemoryConfigured } from '../core/memory-config.js';
import { getChatState, getActiveChatId } from '../core/storage.js';
import { getActiveDossiers } from '../core/dossier-store.js';
import { buildQueryContext } from '../retrieval/query-builder.js';
import { scoreEpisodes } from '../retrieval/score-episodes.js';
import { formatToolResult } from '../retrieval/formatter.js';
import { llmRerank } from '../retrieval/llm-reranker.js';
import { createLLMCaller } from '../llm/api.js';

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

/**
 * Filter dossiers to only those whose name/aliases match query terms.
 * If no name matches, returns all dossiers (scene/event queries).
 */
function filterDossiersByQuery(dossiers, queryTerms) {
    if (!queryTerms.length || !dossiers.length) return dossiers;

    const matched = dossiers.filter(d => {
        const names = [d.name, ...(d.aliases || [])]
            .filter(Boolean)
            .map(n => n.toLowerCase());
        return queryTerms.some(term => names.some(n => n.includes(term)));
    });

    return matched.length > 0 ? matched : dossiers;
}

async function handleRecallMemory({ query }) {
    const settings = getSettings();
    if (!isMemoryConfigured(settings)) {
        return getMemoryInactiveReason(settings);
    }
    const chatId = getActiveChatId();
    const chatState = getChatState(chatId);

    const queryContext = buildQueryContext({
        recentMessages: [{ text: String(query || '') }],
        sceneCard: chatState?.sceneCard,
    });

    const includeArchived = settings.archivedSearchEnabled !== false;
    const archivedPenalty = Number(settings.archivedScorePenalty) || 0.5;

    let scoredEpisodes = scoreEpisodes(chatState?.episodes || [], queryContext, {
        includeArchived,
        archivedPenalty,
    });

    const candidateCount = Math.max(DEFAULT_CANDIDATE_COUNT, Number(settings.retrievalCandidateCount) || DEFAULT_CANDIDATE_COUNT);
    const maxResults = Math.max(5, Number(settings.maxEpisodesInjected) || 3);

    // LLM reranking pass — returns [{item, score}] same shape as scoreEpisodes
    try {
        const llmCallFn = createLLMCaller(settings);
        scoredEpisodes = await llmRerank({
            episodes: scoredEpisodes.slice(0, candidateCount).map(e => e.item),
            queryContext,
            llmCallFn,
            chunkSize: Number(settings.retrievalChunkSize) || 5,
            maxResults,
            keywordFallbackFn: () => scoredEpisodes,
        });
    } catch {
        // Fall through with keyword-scored episodes
    }

    const episodes = scoredEpisodes.slice(0, maxResults).map(e => e.item);

    let dossiers = [];
    try {
        const currentMessageId = Number(chatState?.lastEpisodeBoundaryMessageId) || 0;
        dossiers = getActiveDossiers(chatId, chatState?.sceneCard?.participants || [], { currentMessageId });
        dossiers = filterDossiersByQuery(dossiers, queryContext.queryTerms || []);
    } catch { /* fail-open */ }

    const result = formatToolResult({
        sceneCard: chatState?.sceneCard || null,
        episodes,
        dossiers,
    });

    return result || 'No relevant memories found.';
}
