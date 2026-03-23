const MAX_MESSAGES = 15;
const MAX_MSG_CHARS = 200;
const MAX_OUTPUT_CHARS = 600;

const SYSTEM_PROMPT = 'You are a concise memory recorder for a roleplay session.';

const USER_PROMPT_PREFIX = 'Summarize these roleplay messages into a concise memory entry. Preserve: specific character names, important objects, locations, emotional states, causal relationships (X happened because Y), and unresolved questions. Max 3 sentences, under 500 characters.';

export async function buildLLMSummary(messages, locations, llmCallFn) {
    if (!Array.isArray(messages) || messages.length === 0 || typeof llmCallFn !== 'function') {
        return buildHeuristicSummary(messages || [], locations || []);
    }

    const formatted = messages
        .slice(-MAX_MESSAGES)
        .map(m => {
            const name = m.name || (m.isUser ? 'User' : 'Character');
            const line = `${name}: ${String(m.text || '')}`;
            return line.length > MAX_MSG_CHARS ? `${line.slice(0, MAX_MSG_CHARS - 3)}...` : line;
        })
        .join('\n');

    const locationLine = Array.isArray(locations) && locations.length > 0
        ? `\nLocations: ${locations.join(', ')}`
        : '';

    const prompt = `${USER_PROMPT_PREFIX}${locationLine}\n\nMessages:\n${formatted}`;

    try {
        const result = await llmCallFn({ prompt, systemPrompt: SYSTEM_PROMPT, maxTokens: 200 });
        if (!result || result.error || !result.text) {
            return buildHeuristicSummary(messages, locations || []);
        }
        const text = String(result.text).trim();
        return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) : text;
    } catch {
        return buildHeuristicSummary(messages, locations || []);
    }
}

export async function buildLLMEpisodeSummary(messages, sceneCard, llmCallFn) {
    if (!Array.isArray(messages) || messages.length === 0 || typeof llmCallFn !== 'function') {
        return null;
    }

    const formatted = messages
        .slice(-MAX_MESSAGES)
        .map(m => {
            const name = m.name || (m.isUser ? 'User' : 'Character');
            const line = `${name}: ${String(m.text || '')}`;
            return line.length > MAX_MSG_CHARS ? `${line.slice(0, MAX_MSG_CHARS - 3)}...` : line;
        })
        .join('\n');

    const locationLine = sceneCard?.location ? `\nLocation: ${sceneCard.location}` : '';
    const participantLine = sceneCard?.participants?.length ? `\nParticipants: ${sceneCard.participants.join(', ')}` : '';

    const prompt = `Summarize this roleplay episode into a memory entry.

Messages:${locationLine}${participantLine}
${formatted}

Return JSON:
{
  "title": "short descriptive title (max 80 chars)",
  "summary": "2-3 sentences preserving character names and causal relationships (max 400 chars)",
  "tags": ["tag1", "tag2"],
  "significance": 3,
  "keyFacts": ["specific fact 1", "specific fact 2"]
}

Focus on: what changed, who did what to whom, what remains unresolved, why it matters.`;

    try {
        const result = await llmCallFn({
            prompt,
            systemPrompt: 'You write concise memory entries for roleplay. Return ONLY valid JSON.',
            maxTokens: 300,
        });
        if (!result?.text) return null;

        const match = String(result.text).match(/\{[\s\S]*\}/);
        if (!match) return null;

        const parsed = JSON.parse(match[0]);
        return {
            title: String(parsed.title || '').slice(0, 80),
            summary: String(parsed.summary || '').slice(0, 600),
            tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 6) : [],
            significance: Math.max(1, Math.min(5, Number(parsed.significance) || 2)),
            keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts.map(String).slice(0, 8) : [],
        };
    } catch {
        return null;
    }
}

export function buildHeuristicSummary(messages, locations) {
    if (!Array.isArray(messages)) return '';
    if (!Array.isArray(locations)) locations = [];

    const excerpts = messages
        .slice(-4)
        .map(message => `${message.name || (message.isUser ? 'User' : 'Character')}: ${String(message.text || '').replace(/\s+/g, ' ').trim()}`)
        .filter(Boolean)
        .map(text => text.length > 140 ? `${text.slice(0, 137)}...` : text);

    const locationText = locations.length > 0 ? `Location context: ${locations.join(', ')}. ` : '';
    return `${locationText}${excerpts.join(' ')}`.trim().slice(0, 600);
}
