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

function trimLocationCandidate(text) {
    if (!text) return '';
    // Reject pronoun-starting phrases ("his eye sockets", "her words")
    if (/^(?:his|her|my|your|their|its|our|he|she|it|they|we|i)\b/i.test(text)) return '';
    // Truncate at auxiliary/clause-boundary verbs
    let trimmed = text
        .replace(/\s+(?:does|did|do|is|are|was|were|has|have|had|will|shall|can|could|would|should|might|must|may|that|which|who|where|when|while|but|yet|so|then|just|simply|suddenly)\b.*/i, '')
        .replace(/\s+\w+n['\u2019]t\b.*/i, '');
    // Cap at 8 words
    const words = trimmed.trim().split(/\s+/);
    return words.length > 8 ? words.slice(0, 8).join(' ') : trimmed.trim();
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
        /\b(?:back at|back in|inside|in|at|near|outside(?: of)?)\s+([A-Z][^,.!?;\n\u2014\u2013""\u201C\u201D()*]{2,48}|the [^,.!?;\n\u2014\u2013""\u201C\u201D()*]{2,48})/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        let candidate = cleanLocationPhrase(match[1]);
        candidate = trimLocationCandidate(candidate);
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
    // Strip RP formatting and quotation marks for cleaner extraction
    const stripped = text
        .replace(/\*[^*]+\*/g, ' ')
        .replace(/[""\u201C\u201D]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const results = [];
    // Split on sentence boundaries (not just ?!) for tighter clauses
    const sentences = stripped.split(/[.!?]+/).map(cleanPhrase).filter(Boolean);

    // Take at most one wh-thread per text block (shortest = most specific)
    let best = '';
    for (const sentence of sentences) {
        if (sentence.length < 15) continue;
        if (/\b(?:I spoke|I said|he said|she said|he asked|she asked|they said|I asked)\b/i.test(sentence)) continue;
        if (/\b(?:who|why|how|what happened|where)\b/i.test(sentence)) {
            if (!best || sentence.length < best.length) best = sentence;
        }
    }
    if (best) results.push(capTail(best, 100));

    const patternMatches = [
        stripped.match(/\bneed to find\s+([^.!?\n]{2,80})/i),
        stripped.match(/\bstill don't know\s+([^.!?\n]{2,80})/i),
        stripped.match(/\btrying to figure out\s+([^.!?\n]{2,80})/i),
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
