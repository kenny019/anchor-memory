// Shared word sets for filtering false positives across extractors.
// Intentionally extensible — add new entries when dogfooding reveals false positives.
const FILLER_WORDS = new Set([
    'the', 'a', 'an', 'of', 'and', 'or', 'his', 'her', 'its', 'their', 'my', 'our', 'your',
]);

const ABSTRACT_WORDS = new Set([
    // emotions / mental states
    'intensity', 'silence', 'darkness', 'light', 'shadow', 'shadows',
    'fear', 'anger', 'joy', 'confusion', 'disbelief', 'awe', 'surprise',
    'horror', 'pain', 'agony', 'despair', 'sorrow', 'grief', 'rage',
    'panic', 'shock', 'wonder', 'disgust', 'contempt', 'doubt',
    'anticipation', 'dread', 'terror', 'fury', 'ecstasy', 'bliss',
    'tears', 'urge', 'impulse', 'desire', 'temptation', 'sleep',
    // sensory / abstract concepts
    'ambient', 'distance', 'moment', 'clarity', 'general', 'particular',
    'response', 'addition', 'return', 'contrast', 'comparison', 'truth',
    'reality', 'earnest', 'haste', 'vain', 'secret', 'private',
    'fact', 'theory', 'mind', 'spirit', 'essence', 'detail', 'brief',
    'short', 'time', 'kind', 'sort', 'way', 'turn', 'breath',
    'unison', 'tandem', 'succession', 'order', 'chaos', 'notice',
    'view', 'past', 'words', 'thoughts', 'memories', 'dreams',
]);

function contentWords(text) {
    return text.toLowerCase().split(/\s+/).filter(w => w.length > 0 && !FILLER_WORDS.has(w));
}

function isAbstractPhrase(text) {
    const words = contentWords(text);
    if (words.length === 0) return true;
    return words.every(w => ABSTRACT_WORDS.has(w));
}

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
        const candidate = cleanLocationPhrase(match[1]);
        if (!candidate || isAbstractPhrase(candidate)) continue;
        return candidate;
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

const TEMPORAL_VAGUE = /\bfor\s+(?:some|a\s+(?:long|short|brief)?\s*(?:time|while|moment|bit))|for\s+quite\b/i;

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
        if (!match) continue;
        const candidate = cleanPhrase(match[1]);
        if (TEMPORAL_VAGUE.test(candidate)) continue;
        // Extract the object after the verb phrase and reject if all abstract
        const objectText = candidate.replace(/^\S+\s+(?:with|from|for)?\s*/i, '');
        if (objectText && isAbstractPhrase(objectText)) continue;
        return candidate;
    }

    return '';
}

function extractOpenThreadCandidates(text) {
    const results = [];
    const questionClauses = text.split(/[!?]/).map(cleanPhrase).filter(Boolean);

    for (const clause of questionClauses) {
        if (/\b(?:who|why|how|what happened|where)\b/i.test(clause)) {
            results.push(capTail(clause, 150));
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

function capTail(text, maxLen) {
    if (text.length <= maxLen) return text;
    const sliced = text.slice(-maxLen);
    const trimmed = sliced.replace(/^\S*\s/, '');
    return trimmed || sliced;
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
