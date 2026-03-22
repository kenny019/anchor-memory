import { createEpisode, EPISODE_TYPE } from '../models/episodes.js';

const MIN_CLUSTER_SIZE = 3;
const JACCARD_THRESHOLD = 0.15;

export function clusterEpisodes(episodes) {
    const eligible = episodes.filter(ep => !ep.archived && ep.type !== EPISODE_TYPE.SEMANTIC);
    if (eligible.length < MIN_CLUSTER_SIZE) return [];

    const tokenSets = eligible.map(ep => episodeTokens(ep));
    const clusters = [];
    const assigned = new Set();

    for (let i = 0; i < eligible.length; i++) {
        if (assigned.has(eligible[i].id)) continue;

        const cluster = [eligible[i]];
        assigned.add(eligible[i].id);

        for (let j = i + 1; j < eligible.length; j++) {
            if (assigned.has(eligible[j].id)) continue;
            if (jaccardSimilarity(tokenSets[i], tokenSets[j]) >= JACCARD_THRESHOLD) {
                cluster.push(eligible[j]);
                assigned.add(eligible[j].id);
            }
        }

        if (cluster.length >= MIN_CLUSTER_SIZE) {
            clusters.push(cluster);
        }
    }

    return clusters;
}

export function buildConsolidationPrompt(cluster) {
    const events = cluster.map((ep, i) => {
        const parts = [`${i + 1}. ${ep.title || 'Untitled'}`];
        if (ep.summary) parts.push(`   ${ep.summary}`);
        if (ep.participants?.length) parts.push(`   Participants: ${ep.participants.join(', ')}`);
        if (ep.locations?.length) parts.push(`   Locations: ${ep.locations.join(', ')}`);
        return parts.join('\n');
    }).join('\n\n');

    return `Summarize these related events into one concise memory entry.
Include: who was involved, where it happened, what happened, and why it matters to the story.
Return a JSON object with these exact keys: title, summary, tags (array), significance (1-5).
Return ONLY the JSON, no other text.

Events:
${events}`;
}

export async function consolidateEpisodes({ chatState, llmCallFn }) {
    const episodes = chatState?.episodes || [];
    const clusters = clusterEpisodes(episodes);
    if (clusters.length === 0) return { archivedIds: [], newEpisodes: [] };

    const archivedIds = [];
    const newEpisodes = [];

    for (const cluster of clusters) {
        const prompt = buildConsolidationPrompt(cluster);
        const result = await llmCallFn({ prompt, systemPrompt: 'You are a concise story memory summarizer.', maxTokens: 300 });

        if (!result?.text) continue;

        const parsed = parseConsolidationResponse(result.text);
        if (!parsed) continue;

        const sourceIds = cluster.map(ep => ep.id);
        const allParticipants = [...new Set(cluster.flatMap(ep => ep.participants || []))];
        const allLocations = [...new Set(cluster.flatMap(ep => ep.locations || []))];
        const minStart = Math.min(...cluster.map(ep => ep.messageStart));
        const maxEnd = Math.max(...cluster.map(ep => ep.messageEnd));

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
        });

        newEpisodes.push(semantic);
        archivedIds.push(...sourceIds);
    }

    return { archivedIds, newEpisodes };
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
        return JSON.parse(match[0]);
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
