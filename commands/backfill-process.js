/**
 * Pure chunk-processing logic for backfill — no SillyTavern imports.
 * Separated so eval/run-v2.js can import without triggering st-context resolution.
 */
import { createEpisode } from '../models/episodes.js';
import { formatMessagesForLLM } from '../writing/format-messages.js';

export const CHUNK_SIZE = 25;
export const MAX_TOKENS = 500;

export function buildChunkPrompt(messages, chunkIndex, totalChunks) {
    const formatted = formatMessagesForLLM(messages, { totalBudget: 6000, maxMessages: CHUNK_SIZE });
    return [
        `Summarize this excerpt from a roleplay chat (chunk ${chunkIndex + 1} of ${totalChunks}).`,
        '',
        'Messages:',
        formatted,
        '',
        'Return JSON:',
        '{',
        '  "episode": {',
        '    "title": "short descriptive title (max 80 chars)",',
        '    "summary": "2-3 sentences: who did what, what changed, why it matters (max 400 chars)",',
        '    "tags": ["tag1", "tag2"],',
        '    "significance": 3,',
        '    "keyFacts": ["specific fact"],',
        '    "participants": ["character name"],',
        '    "location": "place name or empty string"',
        '  },',
        '  "characters": [',
        '    {',
        '      "name": "canonical name",',
        '      "aliases": ["alt name"],',
        '      "relationship": "to protagonist",',
        '      "emotionalState": "mood",',
        '      "knownInfo": ["fact from this excerpt"],',
        '      "goals": "motivation",',
        '      "traits": ["trait"]',
        '    }',
        '  ]',
        '}',
        '',
        'Rules:',
        '- participants MUST include all speaker names exactly as they appear',
        '- characters: only named characters who speak or act',
        '- significance: 1=trivial, 3=notable, 5=pivotal',
        '- return empty arrays/strings for absent fields',
    ].join('\n');
}

export async function processChunk(messages, chunkIndex, totalChunks, llmCallFn) {
    try {
        const prompt = buildChunkPrompt(messages, chunkIndex, totalChunks);
        const { text, error } = await llmCallFn({
            prompt,
            systemPrompt: 'You analyze historical roleplay excerpts. Return ONLY valid JSON.',
            maxTokens: MAX_TOKENS,
        });
        if (error || !text) return null;

        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        const parsed = JSON.parse(match[0]);

        const ep = parsed.episode || {};
        const firstMsg = messages[0];
        const lastMsg = messages[messages.length - 1];

        const episode = createEpisode({
            messageStart: Number(firstMsg?.id ?? 0),
            messageEnd: Number(lastMsg?.id ?? 0),
            title: String(ep.title || '').slice(0, 80),
            summary: String(ep.summary || '').slice(0, 400),
            tags: Array.isArray(ep.tags) ? ep.tags.map(String) : [],
            significance: Number(ep.significance) || 3,
            keyFacts: Array.isArray(ep.keyFacts) ? ep.keyFacts.map(String) : [],
            participants: Array.isArray(ep.participants) ? ep.participants.map(String) : [],
            locations: ep.location ? [String(ep.location)] : [],
            createdAtTs: Date.now() - (totalChunks - chunkIndex) * 1000,
        });

        const characters = (Array.isArray(parsed.characters) ? parsed.characters : [])
            .filter(c => c && String(c.name || '').trim())
            .map(c => ({
                name: String(c.name || '').trim(),
                aliases: Array.isArray(c.aliases) ? c.aliases.map(String) : [],
                relationship: String(c.relationship || ''),
                emotionalState: String(c.emotionalState || ''),
                knownInfo: Array.isArray(c.knownInfo) ? c.knownInfo.map(String) : [],
                goals: String(c.goals || ''),
                traits: Array.isArray(c.traits) ? c.traits.map(String) : [],
            }));

        return { episode, characters };
    } catch (err) {
        console.warn('[AnchorMemory] processChunk failed:', err?.message || err);
        return null;
    }
}
