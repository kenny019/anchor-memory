import { createEpisode, EPISODE_TYPE } from '../models/episodes.js';

const DEFAULT_FANOUT = 4;
const BASE_JACCARD_THRESHOLD = 0.15;

/**
 * Cluster episodes at a specific depth level.
 */
export function clusterEpisodesAtDepth(episodes, targetDepth, { fanout = DEFAULT_FANOUT, jaccardThreshold } = {}) {
    const threshold = jaccardThreshold ?? (BASE_JACCARD_THRESHOLD + targetDepth * 0.1);
    const eligible = episodes.filter(ep => !ep.archived && (ep.depth || 0) === targetDepth);
    if (eligible.length < fanout) return [];

    const tokenSets = eligible.map(ep => episodeTokens(ep));
    const clusters = [];
    const assigned = new Set();

    for (let i = 0; i < eligible.length; i++) {
        if (assigned.has(eligible[i].id)) continue;

        const cluster = [eligible[i]];
        const clusterIds = new Set([eligible[i].id]);

        for (let j = i + 1; j < eligible.length; j++) {
            if (assigned.has(eligible[j].id)) continue;
            if (jaccardSimilarity(tokenSets[i], tokenSets[j]) >= threshold) {
                cluster.push(eligible[j]);
                clusterIds.add(eligible[j].id);
            }
        }

        if (cluster.length >= fanout) {
            clusters.push(cluster);
            for (const id of clusterIds) assigned.add(id);
        }
    }

    return clusters;
}

/** Backward-compatible wrapper: clusters depth-0 raw episodes. */
export function clusterEpisodes(episodes) {
    return clusterEpisodesAtDepth(episodes, 0, { fanout: 3 });
}

/**
 * Build a consolidation prompt appropriate for the target depth.
 */
export function buildConsolidationPrompt(cluster, depth = 0) {
    const events = cluster.map((ep, i) => {
        const parts = [`${i + 1}. ${ep.title || 'Untitled'}`];
        if (ep.summary) parts.push(`   ${ep.summary}`);
        if (ep.participants?.length) parts.push(`   Participants: ${ep.participants.join(', ')}`);
        if (ep.locations?.length) parts.push(`   Locations: ${ep.locations.join(', ')}`);
        if (ep.keyFacts?.length) parts.push(`   Key Facts: ${ep.keyFacts.join('; ')}`);
        return parts.join('\n');
    }).join('\n\n');

    const jsonInstruction = 'Return a JSON object with these exact keys: title, summary, tags (array), significance (1-5), keyFacts (array of important details to preserve).\nReturn ONLY the JSON, no other text.';

    if (depth >= 2) {
        return `Distill these high-level narrative arcs into core themes, character trajectories, and world-state changes.
Preserve the most important details and consequences.
${jsonInstruction}

Arcs:
${events}`;
    }

    if (depth === 1) {
        return `These are summaries of related story arcs. Identify the overarching narrative, key character developments, and lasting consequences.
${jsonInstruction}

Arcs:
${events}`;
    }

    // depth 0 → 1: original behavior
    return `Summarize these related events into one concise memory entry.
Include: who was involved, where it happened, what happened, and why it matters to the story.
${jsonInstruction}

Events:
${events}`;
}

function maxTokensForDepth(depth) {
    if (depth >= 2) return 500;
    if (depth === 1) return 400;
    return 300;
}

/**
 * Multi-depth consolidation with running state.
 */
export async function consolidateEpisodes({ chatState, llmCallFn, settings = {}, maxDepth = 1 }) {
    const fanout = Number(settings.consolidationFanout) || DEFAULT_FANOUT;
    let working = [...(chatState?.episodes || [])];
    const allArchivedIds = new Set();
    const allNewEpisodes = [];

    for (let depth = 0; depth < maxDepth; depth++) {
        const clusters = clusterEpisodesAtDepth(working, depth, { fanout });
        if (clusters.length === 0) continue;

        for (const cluster of clusters) {
            const prompt = buildConsolidationPrompt(cluster, depth);
            const result = await llmCallFn({
                prompt,
                systemPrompt: 'You are a concise story memory summarizer.',
                maxTokens: maxTokensForDepth(depth),
            });

            if (!result?.text) continue;

            const parsed = parseConsolidationResponse(result.text);
            if (!parsed) continue;

            const sourceIds = cluster.map(ep => ep.id);
            const allParticipants = [...new Set(cluster.flatMap(ep => ep.participants || []))];
            const allLocations = [...new Set(cluster.flatMap(ep => ep.locations || []))];
            const minStart = Math.min(...cluster.map(ep => ep.messageStart));
            const maxEnd = Math.max(...cluster.map(ep => ep.messageEnd));

            // Merge child keyFacts, dedupe, cap at 10
            const childKeyFacts = cluster.flatMap(ep => ep.keyFacts || []);
            const parsedKeyFacts = Array.isArray(parsed.keyFacts) ? parsed.keyFacts : [];
            const mergedKeyFacts = [...new Set([...parsedKeyFacts, ...childKeyFacts])].slice(0, 10);

            const semantic = createEpisode({
                messageStart: minStart,
                messageEnd: maxEnd,
                title: parsed.title || `Consolidated: ${cluster[0]?.title || 'Events'}`,
                summary: parsed.summary || cluster.map(ep => ep.summary).join(' ').slice(0, 600),
                participants: allParticipants.slice(0, 8),
                locations: allLocations.slice(0, 4),
                tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6) : [],
                significance: Math.max(1, Math.min(5, Number(parsed.significance) || 3)),
                type: EPISODE_TYPE.SEMANTIC,
                sourceEpisodeIds: sourceIds,
                keyFacts: mergedKeyFacts,
                depth: depth + 1,
            });

            allNewEpisodes.push(semantic);
            for (const id of sourceIds) allArchivedIds.add(id);

            // Update working state so next depth sees new episodes
            working = applyConsolidation({ episodes: working }, { archivedIds: sourceIds, newEpisodes: [semantic] }).episodes;
        }
    }

    return { archivedIds: [...allArchivedIds], newEpisodes: allNewEpisodes };
}

export function applyConsolidation(chatState, { archivedIds, newEpisodes }) {
    const archiveSet = new Set(archivedIds);
    const updatedEpisodes = (chatState.episodes || []).map(ep =>
        archiveSet.has(ep.id) ? { ...ep, archived: true } : ep,
    );
    return {
        ...chatState,
        episodes: [...updatedEpisodes, ...newEpisodes],
        pendingConsolidation: false,
    };
}

function parseConsolidationResponse(text) {
    try {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        return JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1'));
    } catch {
        return null;
    }
}

function episodeTokens(episode) {
    const tokens = new Set();
    for (const p of episode.participants || []) tokens.add(p.toLowerCase());
    for (const l of episode.locations || []) tokens.add(l.toLowerCase());
    for (const t of episode.tags || []) tokens.add(t.toLowerCase());
    return tokens;
}

function jaccardSimilarity(a, b) {
    if (a.size === 0 && b.size === 0) return 0;
    let intersection = 0;
    for (const item of a) {
        if (b.has(item)) intersection++;
    }
    return intersection / (a.size + b.size - intersection);
}
