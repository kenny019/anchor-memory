import { extension_prompt_types, setExtensionPrompt } from '../../../../script.js';
import { getContext } from '../../../st-context.js';
import { getSettings, getPromptKey } from '../core/settings.js';
import { getChatState, getActiveChatId, setRetrievalSnapshot, clearRetrievalSnapshot } from '../core/storage.js';
import { createPromptPayload } from '../integration/prompt-injection.js';
import { buildQueryContext } from '../retrieval/query-builder.js';
import { scoreSceneCard } from '../retrieval/score-state.js';
import { scoreEpisodes } from '../retrieval/score-episodes.js';
import { selectMemoryItems } from '../retrieval/selector.js';
import { formatMemoryBlock } from '../retrieval/formatter.js';
import { rerankEpisodes } from '../retrieval/reranker.js';
import { rlmRetrieve } from '../retrieval/rlm-retriever.js';
import { deepRetrieve } from '../retrieval/deep-retriever.js';
import { refineQuery } from '../retrieval/query-refiner.js';
import { createLLMCaller } from '../llm/api.js';

export async function prepareGenerationMemory({
    chatState,
    recentMessages = [],
    allMessages = [],
    settings = {},
} = {}) {
    const queryContext = buildQueryContext({
        recentMessages,
        sceneCard: chatState?.sceneCard || null,
    });

    const scoredSceneCard = scoreSceneCard(chatState?.sceneCard || null, queryContext);
    let scoredEpisodes;

    if (settings.llmRetrieval) {
        const llmCallFn = createLLMCaller(settings);
        let queryCtx = queryContext;

        scoredEpisodes = await rlmRetrieve({
            episodes: chatState?.episodes || [],
            queryContext: queryCtx,
            llmCallFn,
            chunkSize: Number(settings.retrievalChunkSize) || 10,
            maxResults: 8,
            keywordFallbackFn: () => scoreEpisodes(chatState?.episodes || [], queryCtx),
        });

        // Phase 3: adaptive refinement if all scores low
        const maxScore = scoredEpisodes.reduce((max, s) => Math.max(max, s.score), 0);
        if (maxScore <= 3 && scoredEpisodes.length > 0) {
            queryCtx = await refineQuery({ queryContext: queryCtx, llmCallFn });
            scoredEpisodes = await rlmRetrieve({
                episodes: chatState?.episodes || [],
                queryContext: queryCtx,
                llmCallFn,
                chunkSize: Number(settings.retrievalChunkSize) || 10,
                maxResults: 8,
                keywordFallbackFn: () => scoreEpisodes(chatState?.episodes || [], queryCtx),
            });
        }

        // Phase 2: deep retrieval on top candidates
        if (allMessages.length > 0 && scoredEpisodes.length > 0) {
            scoredEpisodes = await deepRetrieve({
                candidates: scoredEpisodes.slice(0, 8),
                queryContext: queryCtx,
                allMessages,
                llmCallFn,
                maxResults: Number(settings.maxEpisodesInjected) || 3,
            });
        }
    } else {
        scoredEpisodes = scoreEpisodes(chatState?.episodes || [], queryContext);
        if (settings.llmReranking && scoredEpisodes.length > 1) {
            const candidateCount = Number(settings.rerankCandidateCount) || 8;
            const topCandidates = scoredEpisodes.slice(0, candidateCount);
            const timeoutMs = Number(settings.rerankTimeoutMs) || 5000;
            const reranked = await rerankEpisodes({ candidates: topCandidates, queryContext, llmCallFn: createLLMCaller(settings, { timeoutMs }), timeoutMs });
            scoredEpisodes = [...reranked, ...scoredEpisodes.slice(candidateCount)];
        }
    }

    const selected = selectMemoryItems({
        scoredEpisodes,
        scoredSceneCard,
        settings,
    });

    const memoryBlock = formatMemoryBlock({
        episodes: selected.episodes,
        maxChars: Number(settings.maxInjectedChars) || 4000,
        sceneCard: selected.sceneCard,
    });

    return {
        memoryBlock,
        queryContext,
        selected,
    };
}

export async function buildGenerationMemoryBlock(args = {}) {
    return (await prepareGenerationMemory(args)).memoryBlock;
}

export async function runGenerationInterceptor(chat = [], _contextSize, _abort, type) {
    const settings = getSettings();
    if (!settings.enabled) {
        const prompt = createPromptPayload('', settings);
        setExtensionPrompt(getPromptKey(), '', mapPromptPosition(prompt.position), prompt.depth, false, 0);
        clearRetrievalSnapshot(getActiveChatId());
        return;
    }

    if (type === 'quiet') {
        return;
    }

    const chatId = getActiveChatId();
    const chatState = getChatState(chatId);
    const preserveRecent = Number(settings.preserveRecentMessages) || 12;
    const allNormalized = normalizeRecentMessages(chat);
    const recentMessages = allNormalized.slice(-preserveRecent);
    const prepared = await prepareGenerationMemory({
        chatState,
        recentMessages,
        allMessages: allNormalized,
        settings,
    });
    const memoryBlock = prepared.memoryBlock;

    const prompt = createPromptPayload(memoryBlock, settings);
    if (!memoryBlock) {
        setExtensionPrompt(getPromptKey(), '', mapPromptPosition(prompt.position), prompt.depth, false, 0);
        setRetrievalSnapshot(chatId, {
            injectedChars: 0,
            memoryBlock: '',
            queryText: recentMessages.map(message => message.text).join('\n').slice(0, 1000),
            selectedEpisodes: [],
            selectedSceneLines: [],
        });
        return;
    }

    setExtensionPrompt(getPromptKey(), prompt.text, mapPromptPosition(prompt.position), prompt.depth, false, 0);
    setRetrievalSnapshot(chatId, {
        injectedChars: prompt.text.length,
        memoryBlock: prompt.text,
        queryText: recentMessages.map(message => message.text).join('\n').slice(0, 1000),
        selectedEpisodes: prepared.selected.episodes.map(episode => ({
            id: episode.id,
            title: episode.title,
            span: `${episode.messageStart}-${episode.messageEnd}`,
        })),
        selectedSceneLines: getSceneSnapshotLines(prepared.selected.sceneCard),
    });
}

function normalizeRecentMessages(chat = []) {
    const ctx = getContext();
    return chat
        .filter(message => message && !message.is_system)
        .map((message, index) => ({
            id: Number.isFinite(Number(message.messageId)) ? Number(message.messageId) : index,
            isUser: Boolean(message.is_user),
            name: String(message.name || (message.is_user ? ctx.name1 : ctx.name2) || ''),
            text: String(message.mes || ''),
        }));
}

function mapPromptPosition(position) {
    if (position === 'in_prompt') return extension_prompt_types.IN_PROMPT;
    if (position === 'before_prompt') return extension_prompt_types.BEFORE_PROMPT;
    return extension_prompt_types.IN_CHAT;
}

function getSceneSnapshotLines(sceneCard) {
    if (!sceneCard) return [];
    const lines = [];
    if (sceneCard.location) lines.push(`Location: ${sceneCard.location}`);
    if (sceneCard.timeContext) lines.push(`Time: ${sceneCard.timeContext}`);
    if (sceneCard.activeGoal) lines.push(`Goal: ${sceneCard.activeGoal}`);
    if (sceneCard.activeConflict) lines.push(`Conflict: ${sceneCard.activeConflict}`);
    if (sceneCard.participants?.length) lines.push(`Participants: ${sceneCard.participants.join(', ')}`);
    if (sceneCard.openThreads?.length) lines.push(`Open Threads: ${sceneCard.openThreads.join(' | ')}`);
    return lines;
}
