import { EPISODE_TYPE } from '../models/episodes.js';

const BATCH_CONCURRENCY = 5;

export async function rlmRetrieve({
    episodes = [],
    queryContext = {},
    llmCallFn,
    chunkSize = 10,
    maxResults = 3,
    keywordFallbackFn = null,
} = {}) {
    const active = episodes.filter(ep => !ep.archived);
    if (active.length === 0 || typeof llmCallFn !== 'function') {
        return keywordFallbackFn ? keywordFallbackFn() : [];
    }

    // Participant boost: put episodes with matching participants first
    const queryParticipants = (queryContext.sceneParticipants || []).map(p => p.toLowerCase());
    const queryTerms = (queryContext.terms || []);
    const allNames = [...queryParticipants, ...queryTerms].filter(Boolean);

    const prioritized = [...active].sort((a, b) => {
        const aMatch = (a.participants || []).some(p => allNames.some(n => p.toLowerCase().includes(n)));
        const bMatch = (b.participants || []).some(p => allNames.some(n => p.toLowerCase().includes(n)));
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return 0;
    });

    const chunks = partition(prioritized, chunkSize);
    const prompt = buildSceneContext(queryContext);
    const allHits = [];
    let anySuccess = false;

    for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_CONCURRENCY) {
        const batch = chunks.slice(batchStart, batchStart + BATCH_CONCURRENCY);
        const results = await Promise.all(
            batch.map((chunk, batchIdx) =>
                scanChunk(chunk, prompt, llmCallFn).then(hits => {
                    if (hits !== null) anySuccess = true;
                    return hits || [];
                }),
            ),
        );
        for (const hits of results) allHits.push(...hits);
    }

    if (!anySuccess && keywordFallbackFn) {
        console.warn('[AnchorMemory] RLM retrieval: all chunks failed, falling back to keyword scoring');
        return keywordFallbackFn();
    }

    const deduped = deduplicateById(allHits);
    deduped.sort((a, b) => b.score - a.score);
    return deduped;
}

async function scanChunk(chunk, sceneContext, llmCallFn) {
    const episodeList = chunk.map((ep, i) => {
        const summary = (ep.summary || '').slice(0, 150);
        const parts = [`${i + 1}. ${(ep.title || 'Untitled').slice(0, 100)} — ${summary}`];
        if (ep.participants?.length) parts.push(`   Participants: ${ep.participants.join(', ')}`);
        if (ep.locations?.length) parts.push(`   Locations: ${ep.locations.join(', ')}`);
        return parts.join('\n');
    }).join('\n');

    const prompt = `You are evaluating which past story events are relevant to the current scene.

${sceneContext}

Past events:
${episodeList}

Which events are relevant to the current scene? For each relevant event, return its number and a relevance score (1-10).
Return JSON array: [{"n": 1, "s": 8}, {"n": 3, "s": 5}]
Return ONLY the JSON array. If none are relevant, return [].`;

    try {
        const result = await llmCallFn({
            prompt,
            systemPrompt: 'You identify relevant story events. Return only JSON.',
            maxTokens: 150,
        });

        if (!result?.text) return null;
        return parseChunkResponse(result.text, chunk);
    } catch {
        return null;
    }
}

function parseChunkResponse(text, chunk) {
    try {
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return [];
        const items = JSON.parse(match[0]);
        if (!Array.isArray(items)) return [];

        const hits = [];
        for (const item of items) {
            const idx = Number(item.n) - 1;
            const score = Math.max(1, Math.min(10, Number(item.s) || 5));
            if (idx >= 0 && idx < chunk.length) {
                hits.push({
                    item: chunk[idx],
                    score,
                    reasons: ['rlm_relevant'],
                });
            }
        }
        return hits;
    } catch {
        return [];
    }
}

function buildSceneContext(queryContext) {
    const parts = ['Current scene:'];
    if (queryContext.location) parts.push(`- Location: ${queryContext.location}`);
    if (queryContext.sceneParticipants?.length) parts.push(`- Participants: ${queryContext.sceneParticipants.join(', ')}`);
    if (queryContext.openThreads?.length) parts.push(`- Open threads: ${queryContext.openThreads.join(', ')}`);
    const recent = (queryContext.recentText || '').slice(0, 500);
    if (recent) parts.push(`- Recent events: ${recent}`);
    return parts.join('\n');
}

function partition(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

function deduplicateById(hits) {
    const seen = new Map();
    for (const hit of hits) {
        const id = hit.item?.id;
        if (!id) continue;
        const existing = seen.get(id);
        if (!existing || hit.score > existing.score) {
            seen.set(id, hit);
        }
    }
    return [...seen.values()];
}
