const SYSTEM_PROMPT = 'You analyze roleplay scenes. Return ONLY valid JSON.';

const MAX_MESSAGES = 12;
const MAX_MSG_CHARS = 200;

/**
 * LLM-based scene extraction. Returns null on failure (caller handles fallback).
 */
export async function llmExtractScene({
    recentMessages = [],
    chatState = {},
    llmCallFn,
} = {}) {
    if (typeof llmCallFn !== 'function') return null;

    const recent = recentMessages.slice(-MAX_MESSAGES);
    const formatted = recent.map(m => {
        const name = m.name || (m.isUser ? 'User' : 'Character');
        const line = `${name}: ${String(m.text || '')}`;
        return line.length > MAX_MSG_CHARS ? `${line.slice(0, MAX_MSG_CHARS - 3)}...` : line;
    }).join('\n');

    const prevLocation = chatState?.sceneCard?.location || '';
    const prevParticipants = (chatState?.sceneCard?.participants || []).join(', ') || '';

    const prompt = `Analyze these recent roleplay messages.

Recent messages (last ${recent.length}):
${formatted}

Previous scene state:
- Location: ${prevLocation || '(none)'}
- Participants: ${prevParticipants || '(none)'}

Return JSON:
{
  "location": "specific place name, not a pose or abstract concept, empty string if unclear",
  "timeContext": "time of day if mentioned, empty string if not",
  "activeGoal": "what protagonist is currently trying to do, empty string if unclear",
  "activeConflict": "active tension or opposition, empty string if none",
  "openThreads": ["unresolved plot question or tension, max 5"],
  "participants": ["character name currently present in scene"]
}

Rules:
- location must be a concrete place, not an action, pose, or abstract concept
- openThreads are unresolved narrative questions, NOT every dialogue question
- participants MUST include ALL speaker names exactly as they appear in the messages (e.g. if messages show "User:" and "Elena:", return ["User", "Elena"])
- return empty string for fields you cannot determine`;

    try {
        const result = await llmCallFn({ prompt, systemPrompt: SYSTEM_PROMPT, maxTokens: 250 });
        if (!result?.text) return null;

        const match = String(result.text).match(/\{[\s\S]*\}/);
        if (!match) return null;

        const parsed = JSON.parse(match[0]);
        return {
            location: String(parsed.location || ''),
            timeContext: String(parsed.timeContext || ''),
            activeGoal: String(parsed.activeGoal || ''),
            activeConflict: String(parsed.activeConflict || ''),
            openThreads: Array.isArray(parsed.openThreads)
                ? parsed.openThreads.map(t => String(t || '')).filter(Boolean).slice(0, 5)
                : [],
            participants: Array.isArray(parsed.participants)
                ? parsed.participants.map(p => String(p || '')).filter(Boolean).slice(0, 8)
                : [],
        };
    } catch (error) {
        console.warn('[AnchorMemory] LLM extraction failed:', error?.message);
        return null;
    }
}
