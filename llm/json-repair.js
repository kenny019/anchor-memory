/**
 * Shared JSON repair utility for LLM responses.
 * Handles truncated output, trailing commas, unclosed brackets.
 */

/** Parse raw LLM character array into normalized objects. */
export function parseCharacters(raw) {
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

export function parseAndRepairJSON(text, label = 'unknown') {
    if (!text) return null;

    // Extract JSON object
    let jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) {
        const startIdx = text.indexOf('{');
        if (startIdx === -1) {
            console.warn(`[AnchorMemory] ${label}: no JSON found in LLM response`);
            return null;
        }
        jsonStr = text.slice(startIdx);
    }

    // Strip trailing commas before ] or }
    let sanitized = jsonStr.replace(/,\s*([}\]])/g, '$1');

    try {
        return JSON.parse(sanitized);
    } catch {
        // Remove trailing partial string/value
        sanitized = sanitized.replace(/,?\s*"[^"]*$/, '');
        // Close unclosed brackets/braces
        const opens = [];
        let inStr = false;
        let esc = false;
        for (const ch of sanitized) {
            if (esc) { esc = false; continue; }
            if (ch === '\\' && inStr) { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{' || ch === '[') opens.push(ch);
            else if (ch === '}' || ch === ']') opens.pop();
        }
        while (opens.length) {
            sanitized += opens.pop() === '{' ? '}' : ']';
        }
        try {
            const parsed = JSON.parse(sanitized);
            console.warn(`[AnchorMemory] ${label}: repaired truncated JSON`);
            return parsed;
        } catch (jsonErr) {
            console.error(`[AnchorMemory] ${label}: JSON parse failed: ${jsonErr.message}\n--- raw ---\n${text}\n--- sanitized ---\n${sanitized}`);
            return null;
        }
    }
}
