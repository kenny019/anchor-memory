import { formatMessagesForLLM } from './format-messages.js';

const MAX_MESSAGES = 15;

export async function buildLLMEpisodeSummary(messages, sceneCard, llmCallFn) {
    if (!Array.isArray(messages) || messages.length === 0 || typeof llmCallFn !== 'function') {
        return null;
    }

    const formatted = formatMessagesForLLM(messages, { totalBudget: 4000, maxMessages: MAX_MESSAGES });

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

        const parsed = JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1'));
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
