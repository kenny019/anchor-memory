const BATCH_CONCURRENCY = 3;
const MAX_RAW_CHARS = 2500;

export async function deepRetrieve({
    candidates = [],
    queryContext = {},
    allMessages = [],
    llmCallFn,
    maxResults = 3,
} = {}) {
    if (candidates.length === 0 || typeof llmCallFn !== 'function') {
        return candidates.slice(0, maxResults);
    }

    const sceneContext = buildSceneContext(queryContext);
    const batches = partition(candidates, BATCH_CONCURRENCY);
    const scored = [];
    let anySuccess = false;

    for (const batch of batches) {
        const results = await Promise.all(
            batch.map(candidate => scoreCandidate(candidate, sceneContext, allMessages, llmCallFn)),
        );
        for (const result of results) {
            if (result.success) anySuccess = true;
            scored.push(result.candidate);
        }
    }

    if (!anySuccess) {
        return candidates.slice(0, maxResults);
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults);
}

async function scoreCandidate(candidate, sceneContext, allMessages, llmCallFn) {
    try {
        const ep = candidate.item;
        const rawMessages = allMessages.filter(
            m => m.id >= ep.messageStart && m.id <= ep.messageEnd,
        );

        const conversationText = formatMessages(rawMessages, MAX_RAW_CHARS);
        if (!conversationText) {
            return { candidate, success: false };
        }

        const prompt = `You are evaluating whether a past conversation section is relevant to the current scene.

${sceneContext}

Past conversation:
${conversationText}

How relevant is this conversation to the current scene? Score 1-10.
Return JSON: {"s": 8, "reason": "brief reason"}
Return ONLY the JSON object.`;

        const result = await llmCallFn({
            prompt,
            systemPrompt: 'You score relevance of past conversations. Return only JSON.',
            maxTokens: 100,
        });

        if (!result?.text) return { candidate, success: false };

        const parsed = parseResponse(result.text);
        if (!parsed) return { candidate, success: false };

        // Combine Pass 1 + deep score: 30% pass1 + 70% deep (deep reads actual messages, trust it more)
        const combinedScore = (candidate.score * 0.3) + (parsed.s * 0.7);
        return {
            candidate: {
                item: candidate.item,
                score: combinedScore,
                reasons: [...(candidate.reasons || []), 'deep_pass', ...(parsed.reason ? [parsed.reason] : [])],
            },
            success: true,
        };
    } catch {
        return { candidate, success: false };
    }
}

function parseResponse(text) {
    try {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        const obj = JSON.parse(match[0]);
        const s = Math.max(1, Math.min(10, Number(obj.s) || 0));
        if (!s) return null;
        return { s, reason: String(obj.reason || '') };
    } catch {
        return null;
    }
}

function formatMessages(messages, maxChars) {
    const lines = [];
    let total = 0;
    for (const m of messages) {
        const name = m.name || (m.isUser ? 'User' : 'Character');
        const line = `${name}: ${String(m.text || '').slice(0, 200)}`;
        if (total + line.length > maxChars) break;
        lines.push(line);
        total += line.length;
    }
    return lines.join('\n');
}

function buildSceneContext(queryContext) {
    const parts = ['Current scene:'];
    if (queryContext.location) parts.push(`- Location: ${queryContext.location}`);
    if (queryContext.sceneParticipants?.length) parts.push(`- Participants: ${queryContext.sceneParticipants.join(', ')}`);
    const recent = (queryContext.recentText || '').slice(0, 300);
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
