import { createEpisode } from '../models/episodes.js';
import { buildLLMSummary, buildHeuristicSummary } from './llm-summarizer.js';

export async function buildEpisodeCandidate({
    chatState,
    recentMessages = [],
    settings = {},
    titleOverride = '',
    force = false,
    llmCallFn = null,
} = {}) {
    if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
        return null;
    }

    const lastBoundary = Number(chatState?.lastEpisodeBoundaryMessageId ?? -1);
    const candidates = recentMessages.filter(message => Number(message.id) > lastBoundary);
    const threshold = Number(settings.sceneMessageThreshold) || 14;

    if (!force && candidates.length < threshold) {
        return null;
    }

    const messageStart = Number(candidates[0]?.id ?? 0);
    const messageEnd = Number(candidates[candidates.length - 1]?.id ?? 0);
    const participants = uniqueStrings(candidates.map(message => message.name || (message.isUser ? 'User' : 'Character')), 6);
    const locations = uniqueStrings(candidates.map(message => extractLocationCandidate(message.text)).filter(Boolean), 3);
    const title = titleOverride || buildEpisodeTitle(chatState?.sceneCard, locations, chatState?.episodes?.length || 0);
    const summary = llmCallFn && settings.llmSummarization
        ? await buildLLMSummary(candidates, locations, llmCallFn)
        : buildHeuristicSummary(candidates, locations);
    const tags = buildTags(candidates, locations);
    const significance = deriveSignificance(candidates);

    return createEpisode({
        messageStart,
        messageEnd,
        participants,
        locations,
        tags,
        significance,
        summary,
        title,
    });
}

function buildEpisodeTitle(sceneCard, locations, existingCount) {
    if (sceneCard?.location) return `Scene at ${sceneCard.location}`;
    if (locations.length > 0) return `Scene at ${locations[0]}`;
    return `Episode ${existingCount + 1}`;
}

function buildSummary(messages, locations) {
    const excerpts = messages
        .slice(-4)
        .map(message => `${message.name || (message.isUser ? 'User' : 'Character')}: ${String(message.text || '').replace(/\s+/g, ' ').trim()}`)
        .filter(Boolean)
        .map(text => text.length > 140 ? `${text.slice(0, 137)}...` : text);

    const locationText = locations.length > 0 ? `Location context: ${locations.join(', ')}. ` : '';
    return `${locationText}${excerpts.join(' ')}`.trim().slice(0, 600);
}

function buildTags(messages, locations) {
    const joined = messages.map(message => String(message.text || '').toLowerCase()).join(' ');
    const tags = [];

    if (locations.length > 0) tags.push('location');
    if (/\b(fight|attack|ambush|battle)\b/.test(joined)) tags.push('conflict');
    if (/\b(plan|need to|must|trying to)\b/.test(joined)) tags.push('goal');
    if (/\b(secret|mystery|unknown|investigat)\w*\b/.test(joined)) tags.push('mystery');
    if (/\b(?:trust|betray|love|friend|relationship)\b/.test(joined)) tags.push('relationship');

    return uniqueStrings(tags, 4);
}

function deriveSignificance(messages) {
    const joined = messages.map(message => String(message.text || '').toLowerCase()).join(' ');
    if (/\b(dead|death|killed|betray|confess|explosion|destroyed)\b/.test(joined)) return 5;
    if (/\b(fight|attack|ambush|escape|reveal)\b/.test(joined)) return 4;
    if (messages.length >= 20) return 3;
    return 2;
}

function extractLocationCandidate(text) {
    const match = String(text || '').match(/\b(?:back at|back in|inside|in|at|near|outside(?: of)?)\s+([A-Z][^,.!?;\n\u2014\u2013""\u201C\u201D()*]{2,48}|the [^,.!?;\n\u2014\u2013""\u201C\u201D()*]{2,48})/i);
    return match ? cleanLocationPhrase(match[1]) : '';
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
    const seen = new Set();
    const result = [];

    for (const value of values) {
        const cleaned = cleanPhrase(value);
        if (!cleaned) continue;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(cleaned);
        if (result.length >= limit) break;
    }

    return result;
}
