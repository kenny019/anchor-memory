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
