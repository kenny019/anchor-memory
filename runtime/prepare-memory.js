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

function snapshotScored(entries) {
    return entries.map((entry, i) => ({
        episodeId: entry.item.id || `${entry.item.messageStart}:${entry.item.messageEnd}`,
        score: entry.score,
        reasons: [...(entry.reasons || [])],
        rank: i,
    }));
}

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
    const originalTerms = [...(queryContext.terms || [])];

    const scoredSceneCard = scoreSceneCard(chatState?.sceneCard || null, queryContext);
    const keywordRanked = scoreEpisodes(chatState?.episodes || [], queryContext);
    const candidateCount = Number(settings.retrievalCandidateCount) || DEFAULT_CANDIDATE_COUNT;
    let queryCtx = queryContext;
    let scoredEpisodes = keywordRanked.slice(0, candidateCount);

    let queryRefined = false;
    let keywordSnapshot = null;
    let rerankSnapshot = null;
    let deepSnapshot = null;
    let llmRerankUsed = false;
    let rerankFellBack = false;
    let deepRetrieveUsed = false;

    if (typeof llmCallFn === 'function' && scoredEpisodes.length > 0) {
        const maxScore = scoredEpisodes.reduce((max, entry) => Math.max(max, entry.score), 0);
        if (maxScore <= 3) {
            queryRefined = true;
            queryCtx = await refineQuery({ queryContext, llmCallFn });
            scoredEpisodes = scoreEpisodes(chatState?.episodes || [], queryCtx).slice(0, candidateCount);
        }

        // Capture keyword snapshot AFTER refinement branch — this is the effective baseline
        keywordSnapshot = snapshotScored(scoredEpisodes);

        llmRerankUsed = true;
        scoredEpisodes = await llmRerank({
            episodes: scoredEpisodes.map(entry => entry.item),
            queryContext: queryCtx,
            llmCallFn,
            chunkSize: Number(settings.retrievalChunkSize) || 5,
            maxResults: candidateCount,
            keywordFallbackFn: () => scoreEpisodes(chatState?.episodes || [], queryCtx).slice(0, candidateCount),
        });
        rerankFellBack = !scoredEpisodes.some(e => e.reasons?.includes('llm_relevant'));
        rerankSnapshot = snapshotScored(scoredEpisodes);

        if (allMessages.length > 0 && scoredEpisodes.length > 0) {
            deepRetrieveUsed = true;
            scoredEpisodes = await deepRetrieve({
                candidates: scoredEpisodes.slice(0, candidateCount),
                queryContext: queryCtx,
                allMessages,
                llmCallFn,
                maxResults: Number(settings.maxEpisodesInjected) || 3,
            });
            deepSnapshot = snapshotScored(scoredEpisodes);
        }
    } else {
        // No LLM path — keyword only
        keywordSnapshot = snapshotScored(scoredEpisodes);
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

    // Build eval data — join scoring passes by episode id
    const selectedIds = new Set(selected.episodes.map(ep => ep.id));
    const allEpisodeKeys = new Set();
    for (const snap of [keywordSnapshot, rerankSnapshot, deepSnapshot]) {
        if (snap) snap.forEach(e => allEpisodeKeys.add(e.episodeId));
    }
    const episodeLookup = new Map();
    for (const ep of (chatState?.episodes || [])) {
        const key = ep.id || `${ep.messageStart}:${ep.messageEnd}`;
        if (allEpisodeKeys.has(key)) {
            episodeLookup.set(key, ep);
            if (episodeLookup.size === allEpisodeKeys.size) break;
        }
    }

    const scoringTraces = [...allEpisodeKeys].map(id => {
        const kw = keywordSnapshot?.find(e => e.episodeId === id) || null;
        const rr = rerankSnapshot?.find(e => e.episodeId === id) || null;
        const dp = deepSnapshot?.find(e => e.episodeId === id) || null;
        const ep = episodeLookup.get(id);
        return {
            episodeId: id,
            episodeTitle: ep?.title || '(unknown)',
            span: ep ? `${ep.messageStart}-${ep.messageEnd}` : '',
            selected: selectedIds.has(id),
            passes: {
                keyword: kw ? { score: kw.score, reasons: kw.reasons, rank: kw.rank } : null,
                rerank: rr ? { score: rr.score, reasons: rr.reasons, rank: rr.rank } : null,
                deep: dp ? { score: dp.score, reasons: dp.reasons, rank: dp.rank } : null,
            },
        };
    });

    const evalData = {
        scoringTraces,
        pipelineMetadata: {
            queryRefined,
            originalTerms,
            refinedTerms: queryRefined ? [...(queryCtx.terms || [])] : null,
            candidateCount,
            keywordCandidates: keywordSnapshot?.length || 0,
            rerankCandidates: rerankSnapshot?.length || 0,
            deepCandidates: deepSnapshot?.length || 0,
            llmRerankUsed,
            rerankFellBack,
            deepRetrieveUsed,
            timestamp: Date.now(),
        },
    };

    return {
        memoryBlock,
        queryContext: queryCtx,
        selected,
        evalData,
    };
}
