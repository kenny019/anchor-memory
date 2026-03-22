/**
 * Broadens a search query when initial retrieval finds nothing relevant.
 * Asks an LLM to extract key entities and related concepts, returns enriched queryContext.
 */

function buildRefinePrompt(queryContext) {
    const location = queryContext.location || 'unknown';
    const participants = (queryContext.sceneParticipants || []).join(', ') || 'none';
    const recentText = (queryContext.recentText || '').slice(0, 300);
    const terms = (queryContext.terms || []).join(', ');

    return `The following search query found no relevant results in a roleplay memory system.

Query context:
- Location: ${location}
- Participants: ${participants}
- Recent text: ${recentText}
- Search terms: ${terms}

Extract the key entities (character names, locations, objects) and suggest 5-10 related search terms that might find relevant memories.
Include synonyms, related concepts, and character names mentioned.

Return JSON: {"terms": ["term1", "term2", ...], "entities": ["name1", "location1", ...]}
Return ONLY the JSON.`;
}

function parseRefineResponse(text) {
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[0]);
        const terms = Array.isArray(parsed.terms) ? parsed.terms.filter(t => typeof t === 'string') : [];
        const entities = Array.isArray(parsed.entities) ? parsed.entities.filter(e => typeof e === 'string') : [];
        return { terms, entities };
    } catch {
        return null;
    }
}

function mergeTerms(original, added) {
    const seen = new Set(original.map(t => t.toLowerCase()));
    const merged = [...original];
    for (const term of added) {
        const lower = term.toLowerCase().trim();
        if (lower && !seen.has(lower)) {
            seen.add(lower);
            merged.push(lower);
        }
    }
    return merged;
}

const LOCATION_PATTERN = /\b(room|hall|castle|forest|tavern|city|town|village|cave|mountain|river|lake|house|temple|church|market|street|garden|tower|dungeon|palace|inn|shop|bridge|gate|port|harbor|island|kingdom|realm|land)\b/i;

function classifyEntities(entities, currentParticipants, currentLocation) {
    const participantsLower = new Set(currentParticipants.map(p => p.toLowerCase()));
    const locationLower = (currentLocation || '').toLowerCase();

    const newParticipants = [];
    let newLocation = null;

    for (const entity of entities) {
        const trimmed = entity.trim();
        const lower = trimmed.toLowerCase();
        if (!lower) continue;

        const isLocation = !newLocation
            && (!locationLower || !lower.includes(locationLower))
            && LOCATION_PATTERN.test(trimmed);

        if (isLocation) {
            newLocation = trimmed;
        } else if (!participantsLower.has(lower)) {
            newParticipants.push(trimmed);
        }
    }

    return { newParticipants, newLocation };
}

export async function refineQuery({ queryContext, llmCallFn }) {
    if (!queryContext || typeof llmCallFn !== 'function') {
        return queryContext || {};
    }

    try {
        const prompt = buildRefinePrompt(queryContext);
        const result = await llmCallFn({
            prompt,
            systemPrompt: 'You extract entities and suggest search terms for a roleplay memory system. Be concise.',
            maxTokens: 150,
        });

        const parsed = parseRefineResponse(result?.text);
        if (!parsed) return queryContext;

        const mergedTerms = mergeTerms(queryContext.terms || [], parsed.terms);
        const { newParticipants, newLocation } = classifyEntities(
            parsed.entities,
            queryContext.sceneParticipants || [],
            queryContext.location || '',
        );

        return {
            ...queryContext,
            terms: mergedTerms,
            sceneParticipants: newParticipants.length > 0
                ? [...(queryContext.sceneParticipants || []), ...newParticipants]
                : queryContext.sceneParticipants || [],
            location: newLocation || queryContext.location || '',
        };
    } catch {
        return queryContext;
    }
}
