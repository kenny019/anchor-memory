export function extractStateUpdates({
    chatState,
    recentMessages = [],
    latestAssistantMessage = null,
} = {}) {
    void chatState;
    void latestAssistantMessage;

    const sourceMessages = recentMessages.slice(-12);
    const texts = sourceMessages.map(message => String(message?.text || '').trim()).filter(Boolean);
    const participants = uniqueStrings(sourceMessages.map(message => message?.name || ''));
    const location = findLatestValue(texts, extractLocationCandidate);
    const timeContext = findLatestValue(texts, extractTimeContextCandidate);
    const activeGoal = findLatestValue(texts, extractGoalCandidate);
    const activeConflict = findLatestValue(texts, extractConflictCandidate);
    const openThreads = uniqueStrings(texts.flatMap(extractOpenThreadCandidates), 8);

    return {
        location,
        timeContext,
        activeGoal,
        activeConflict,
        openThreads,
        participants,
    };
}

function findLatestValue(texts, extractor) {
    for (let index = texts.length - 1; index >= 0; index--) {
        const candidate = extractor(texts[index]);
        if (candidate) return candidate;
    }
    return '';
}

function extractLocationCandidate(text) {
    const patterns = [
        /\b(?:back at|back in|inside|in|at|near|outside(?: of)?)\s+([A-Z][^,.!?;\n]{2,48}|the [^,.!?;\n]{2,48})/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        return cleanLocationPhrase(match[1]);
    }

    return '';
}

function extractTimeContextCandidate(text) {
    const match = text.match(/\b(morning|afternoon|evening|night|midnight|noon|dawn|dusk|sunrise|sunset|later|the next day|the following day|tomorrow|yesterday)\b/i);
    return match ? cleanPhrase(match[1]) : '';
}

function extractGoalCandidate(text) {
    const match = text.match(/\b(?:need to|needs to|trying to|tries to|must|have to|plan to|plans to|want to|wants to)\s+([^.!?\n]{4,100})/i);
    return match ? cleanPhrase(match[1]) : '';
}

function extractConflictCandidate(text) {
    const patterns = [
        /\b(arguing with [^.!?\n]{2,80})/i,
        /\b(fighting [^.!?\n]{2,80})/i,
        /\b(chasing [^.!?\n]{2,80})/i,
        /\b(hiding from [^.!?\n]{2,80})/i,
        /\b(running from [^.!?\n]{2,80})/i,
        /\b(investigating [^.!?\n]{2,80})/i,
        /\b(searching for [^.!?\n]{2,80})/i,
        /\b(escaping [^.!?\n]{2,80})/i,
        /\b(negotiating with [^.!?\n]{2,80})/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return cleanPhrase(match[1]);
    }

    return '';
}

function extractOpenThreadCandidates(text) {
    const results = [];
    const questionClauses = text.split(/[!?]/).map(cleanPhrase).filter(Boolean);

    for (const clause of questionClauses) {
        if (/\b(?:who|why|how|what happened|where)\b/i.test(clause)) {
            results.push(clause);
        }
    }

    const patternMatches = [
        text.match(/\bneed to find\s+([^.!?\n]{2,80})/i),
        text.match(/\bstill don't know\s+([^.!?\n]{2,80})/i),
        text.match(/\btrying to figure out\s+([^.!?\n]{2,80})/i),
    ].filter(Boolean);

    for (const match of patternMatches) {
        results.push(cleanPhrase(match[0]));
    }

    return results;
}

function cleanPhrase(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/^[-:,; ]+|[-:,; ]+$/g, '')
        .trim();
}

function cleanLocationPhrase(value) {
    return cleanPhrase(value)
        .replace(/\b(?:at|by|during)\s+(?:dawn|dusk|sunrise|sunset|morning|afternoon|evening|night|midnight|noon)\b/i, '')
        .trim();
}

function uniqueStrings(values, limit = Infinity) {
    const result = [];

    for (const value of values) {
        const cleaned = cleanPhrase(value);
        if (!cleaned) continue;
        const key = cleaned.toLowerCase();
        const existingIndex = result.findIndex(item => item.toLowerCase() === key);
        if (existingIndex >= 0) continue;

        const containedIndex = result.findIndex(item => item.toLowerCase().includes(key));
        if (containedIndex >= 0) {
            result[containedIndex] = cleaned;
        } else if (result.some(item => key.includes(item.toLowerCase()))) {
            continue;
        } else {
            result.push(cleaned);
        }
        if (result.length >= limit) break;
    }

    return result;
}
