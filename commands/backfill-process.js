/**
 * Pure chunk-processing logic for backfill — no SillyTavern imports.
 * Separated so eval/run-v2.js can import without triggering st-context resolution.
 */
import { createEpisode } from '../models/episodes.js';
import { formatMessagesForLLM } from '../writing/format-messages.js';
import { parseAndRepairJSON, parseCharacters } from '../llm/json-repair.js';

export const CHUNK_SIZE = 25;
const SYSTEM_PROMPT = 'You analyze historical roleplay excerpts. Return ONLY valid JSON.';

export function buildEpisodePrompt(formatted, chunkIndex, totalChunks) {
    return [
        `Summarize this excerpt from a roleplay chat (chunk ${chunkIndex + 1} of ${totalChunks}).`,
        '',
        'Messages:',
        formatted,
        '',
        'Return JSON:',
        '{',
        '  "title": "short descriptive title (max 80 chars)",',
        '  "summary": "2-3 sentences: who did what, what changed, why it matters (max 400 chars)",',
        '  "tags": ["tag1", "tag2"],',
        '  "significance": 3,',
        '  "keyFacts": ["specific fact"],',
        '  "participants": ["character name"],',
        '  "location": "place name or empty string"',
        '}',
        '',
        'Rules:',
        '- participants MUST include all speaker names exactly as they appear',
        '- significance: 1=trivial, 3=notable, 5=pivotal',
        '- return empty arrays/strings for absent fields',
    ].join('\n');
}

export function buildCharacterPrompt(formatted, chunkIndex, totalChunks) {
    return [
        `Extract characters from this roleplay chat excerpt (chunk ${chunkIndex + 1} of ${totalChunks}).`,
        '',
        'Messages:',
        formatted,
        '',
        'Return JSON:',
        '{',
        '  "characters": [',
        '    {',
        '      "name": "canonical name",',
        '      "aliases": ["alt name"],',
        '      "relationship": "to protagonist",',
        '      "emotionalState": "mood",',
        '      "knownInfo": ["fact from this excerpt (max 2)"],',
        '      "goals": "motivation",',
        '      "traits": ["trait (max 3)"]',
        '    }',
        '  ]',
        '}',
        '',
        'Rules:',
        '- only named characters who speak or act',
        '- max 2 knownInfo items per character',
        '- max 3 traits per character',
        '- return empty arrays/strings for absent fields',
    ].join('\n');
}

export async function processChunk(messages, chunkIndex, totalChunks, llmCallFn) {
    try {
        const formatted = formatMessagesForLLM(messages, { totalBudget: 6000, maxMessages: CHUNK_SIZE });

        const episodePrompt = buildEpisodePrompt(formatted, chunkIndex, totalChunks);
        const characterPrompt = buildCharacterPrompt(formatted, chunkIndex, totalChunks);

        const [episodeResult, characterResult] = await Promise.all([
            llmCallFn({ prompt: episodePrompt, systemPrompt: SYSTEM_PROMPT, maxTokens: 500 }),
            llmCallFn({ prompt: characterPrompt, systemPrompt: SYSTEM_PROMPT, maxTokens: 600 }),
        ]);

        const label = `chunk ${chunkIndex + 1}/${totalChunks}`;

        // Episode is required
        if (episodeResult.error || !episodeResult.text) return null;
        const epParsed = parseAndRepairJSON(episodeResult.text, `${label} episode`);
        if (!epParsed) return null;

        const ep = epParsed.episode || epParsed;
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

        // Characters are best-effort
        let characters = [];
        if (!characterResult.error && characterResult.text) {
            const charParsed = parseAndRepairJSON(characterResult.text, `${label} characters`);
            if (charParsed) {
                const raw = Array.isArray(charParsed.characters) ? charParsed.characters
                    : Array.isArray(charParsed) ? charParsed : [];
                characters = parseCharacters(raw);
            }
        }

        return { episode, characters };
    } catch (err) {
        console.warn('[AnchorMemory] processChunk failed:', err?.message || err);
        return null;
    }
}
