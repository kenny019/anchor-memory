import { DEFAULT_CANDIDATE_COUNT } from '../core/budget.js';
import { buildQueryContext } from '../retrieval/query-builder.js';
import { scoreSceneCard } from '../retrieval/score-state.js';
import { scoreEpisodes } from '../retrieval/score-episodes.js';
import { selectMemoryItems } from '../retrieval/selector.js';
import { formatMemoryBlock } from '../retrieval/formatter.js';
import { llmRerank } from '../retrieval/llm-reranker.js';
import { deepRetrieve } from '../retrieval/deep-retriever.js';
import { refineQuery } from '../retrieval/query-refiner.js';
import { getActiveDossiers } from '../core/dossier-store.js';

export async function prepareGenerationMemoryData({
    chatState,
    chatId = null,
    recentMessages = [],
    allMessages = [],
    settings = {},
    llmCallFn = null,
} = {}) {
    const queryContext = buildQueryContext({
        recentMessages,
        sceneCard: chatState?.sceneCard || null,
    });

    const scoredSceneCard = scoreSceneCard(chatState?.sceneCard || null, queryContext);
    const keywordRanked = scoreEpisodes(chatState?.episodes || [], queryContext);
    const candidateCount = Number(settings.retrievalCandidateCount) || DEFAULT_CANDIDATE_COUNT;
    let queryCtx = queryContext;
    let scoredEpisodes = keywordRanked.slice(0, candidateCount);

    if (typeof llmCallFn === 'function' && scoredEpisodes.length > 0) {
        const maxScore = scoredEpisodes.reduce((max, entry) => Math.max(max, entry.score), 0);
        if (maxScore <= 3) {
            queryCtx = await refineQuery({ queryContext, llmCallFn });
            scoredEpisodes = scoreEpisodes(chatState?.episodes || [], queryCtx).slice(0, candidateCount);
        }

        scoredEpisodes = await llmRerank({
            episodes: scoredEpisodes.map(entry => entry.item),
            queryContext: queryCtx,
            llmCallFn,
            chunkSize: Number(settings.retrievalChunkSize) || 5,
            maxResults: candidateCount,
            keywordFallbackFn: () => scoreEpisodes(chatState?.episodes || [], queryCtx).slice(0, candidateCount),
        });

        if (allMessages.length > 0 && scoredEpisodes.length > 0) {
            scoredEpisodes = await deepRetrieve({
                candidates: scoredEpisodes.slice(0, candidateCount),
                queryContext: queryCtx,
                allMessages,
                llmCallFn,
                maxResults: Number(settings.maxEpisodesInjected) || 3,
            });
        }
    }

    const selected = selectMemoryItems({
        scoredEpisodes,
        scoredSceneCard,
        settings: { ...settings, archivedMaxResults: 0 },
    });

    let dossiers = [];
    if (chatId) {
        try {
            const lastMsg = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;
            const currentMessageId = Number(lastMsg?.id) || 0;
            dossiers = getActiveDossiers(chatId, chatState?.sceneCard?.participants || [], { currentMessageId });
        } catch { /* fail-open */ }
    }

    const memoryBlock = formatMemoryBlock({
        episodes: selected.episodes,
        dossiers,
        maxChars: Number(settings.maxInjectedChars) || 4000,
        sceneCard: selected.sceneCard,
        format: settings.memoryFormat || 'text',
    });

    return {
        memoryBlock,
        queryContext: queryCtx,
        selected,
    };
}
