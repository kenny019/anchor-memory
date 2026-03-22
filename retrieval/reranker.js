export async function rerankEpisodes({
    candidates = [],
    queryContext = {},
    llmCallFn,
    timeoutMs = 5000,
} = {}) {
    if (candidates.length <= 1 || typeof llmCallFn !== 'function') {
        return candidates;
    }

    try {
        const prompt = buildRerankPrompt(candidates, queryContext);
        const result = await llmCallFn({ prompt, systemPrompt: 'You rank memory episodes by relevance. Be concise.', maxTokens: 100, timeoutMs });

        if (!result?.text) return candidates;

        const reordered = parseRerankResponse(result.text, candidates);
        return reordered.length > 0 ? reordered : candidates;
    } catch {
        return candidates;
    }
}

function buildRerankPrompt(candidates, queryContext) {
    const sceneParts = [];
    if (queryContext.location) sceneParts.push(`Location: ${queryContext.location}`);
    if (queryContext.sceneParticipants?.length) sceneParts.push(`Participants: ${queryContext.sceneParticipants.join(', ')}`);
    const sceneContext = sceneParts.length > 0 ? sceneParts.join('\n') : 'No current scene context';

    const recentSnippet = (queryContext.recentText || '').slice(0, 500);

    const episodeList = candidates.map((ep, i) => {
        const item = ep.item || ep;
        const summary = (item.summary || '').slice(0, 150);
        return `${i + 1}. ${item.title || 'Untitled'} - ${summary}`;
    }).join('\n');

    return `Current scene:
${sceneContext}

Recent context:
${recentSnippet}

Rank these memory episodes by relevance to the current scene. Return ONLY the numbers in order, most relevant first.

${episodeList}`;
}

function parseRerankResponse(text, candidates) {
    const numbers = text.match(/\d+/g);
    if (!numbers) return [];

    const seen = new Set();
    const reordered = [];

    for (const numStr of numbers) {
        const idx = parseInt(numStr, 10) - 1;
        if (idx >= 0 && idx < candidates.length && !seen.has(idx)) {
            seen.add(idx);
            reordered.push(candidates[idx]);
        }
    }

    for (let i = 0; i < candidates.length; i++) {
        if (!seen.has(i)) reordered.push(candidates[i]);
    }

    return reordered;
}
