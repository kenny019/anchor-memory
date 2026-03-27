import { formatMessagesForLLM } from './format-messages.js';

const SYSTEM_PROMPT = 'You analyze roleplay scenes. Return ONLY valid JSON.';

const MAX_MESSAGES = 12;

/**
 * LLM-based scene extraction + boundary detection + character deltas.
 * Returns null on failure (caller handles fallback).
 */
export async function llmExtractScene({
    recentMessages = [],
    chatState = {},
    llmCallFn,
} = {}) {
    if (typeof llmCallFn !== 'function') return null;

    const recent = recentMessages.slice(-MAX_MESSAGES);
    const formatted = formatMessagesForLLM(recent, { totalBudget: 3500, maxMessages: MAX_MESSAGES });

    const prevLocation = chatState?.sceneCard?.location || '';
    const prevParticipants = (chatState?.sceneCard?.participants || []).join(', ') || '';
    const lastBoundary = Number(chatState?.lastEpisodeBoundaryMessageId ?? -1);
    const messagesSinceBoundary = recentMessages.filter(m => Number(m.id) > lastBoundary).length;

    const prompt = `Analyze these recent roleplay messages.

Recent messages (last ${recent.length}):
${formatted}

${messagesSinceBoundary} messages have passed since the last episode boundary.

Previous scene state:
- Location: ${prevLocation || '(none)'}
- Participants: ${prevParticipants || '(none)'}

Return JSON:
{
  "scene": {
    "location": "specific place name, not a pose or abstract concept, empty string if unclear",
    "timeContext": "time of day if mentioned, empty string if not",
    "activeGoal": "what protagonist is currently trying to do, empty string if unclear",
    "activeConflict": "active tension or opposition, empty string if none",
    "openThreads": ["unresolved plot question or tension, max 5"],
    "participants": ["character name currently present in scene"]
  },
  "boundary": {
    "shouldCreate": false,
    "reason": "location_change|significant_event|dramatic_beat",
    "significance": 3,
    "title": "short descriptive title for the episode being closed"
  },
  "characters": [
    {
      "name": "canonical name",
      "aliases": ["alternate name"],
      "relationship": "relationship to protagonist",
      "emotionalState": "current mood",
      "knownInfo": ["new fact learned THIS turn only"],
      "goals": "current motivation",
      "traits": ["observable personality trait"]
    }
  ]
}

Rules:
- location must be a concrete place, not an action, pose, or abstract concept
- openThreads are unresolved narrative questions, NOT every dialogue question
- participants MUST include ALL speaker names exactly as they appear in the messages
- boundary.shouldCreate = true when: a scene/location change occurred, a significant event happened (betrayal, combat, revelation, death), or a natural dramatic beat concluded
- characters: only include characters who DID something or REVEALED something this turn
- characters.knownInfo: only NEW facts, not previously known information
- do not include characters merely mentioned in passing
- return empty string for fields you cannot determine`;

    try {
        const result = await llmCallFn({ prompt, systemPrompt: SYSTEM_PROMPT, maxTokens: 450 });
        if (!result?.text) return null;

        const match = String(result.text).match(/\{[\s\S]*\}/);
        if (!match) return null;

        const parsed = JSON.parse(match[0]);

        // Handle both nested {scene, boundary} and flat format
        const scene = parsed.scene || parsed;
        const boundary = parsed.boundary || null;
        const characters = parseCharacters(parsed.characters);

        return {
            location: String(scene.location || ''),
            timeContext: String(scene.timeContext || ''),
            activeGoal: String(scene.activeGoal || ''),
            activeConflict: String(scene.activeConflict || ''),
            openThreads: Array.isArray(scene.openThreads)
                ? scene.openThreads.map(t => String(t || '')).filter(Boolean).slice(0, 5)
                : [],
            participants: Array.isArray(scene.participants)
                ? scene.participants.map(p => String(p || '')).filter(Boolean).slice(0, 8)
                : [],
            boundary: boundary?.shouldCreate ? {
                shouldCreate: true,
                reason: String(boundary.reason || ''),
                significance: Math.max(1, Math.min(5, Number(boundary.significance) || 2)),
                title: String(boundary.title || ''),
            } : null,
            characters,
        };
    } catch (error) {
        console.warn('[AnchorMemory] LLM extraction failed:', error?.message);
        return null;
    }
}

// Lightweight parse — only filters out nameless entries and coerces types.
// Cap enforcement is handled downstream by normalizeDossier via mergeDossier.
function parseCharacters(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(c => c && typeof c === 'object' && String(c.name || '').trim())
        .map(c => ({
            name: String(c.name || '').trim(),
            aliases: Array.isArray(c.aliases) ? c.aliases.map(String).filter(Boolean) : [],
            relationship: String(c.relationship || ''),
            emotionalState: String(c.emotionalState || ''),
            knownInfo: Array.isArray(c.knownInfo) ? c.knownInfo.map(String).filter(Boolean) : [],
            goals: String(c.goals || ''),
            traits: Array.isArray(c.traits) ? c.traits.map(String).filter(Boolean) : [],
        }));
}
