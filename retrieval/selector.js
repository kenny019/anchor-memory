export function selectMemoryItems({
    scoredSceneCard = null,
    scoredEpisodes = [],
    settings = {},
} = {}) {
    const maxEpisodes = Number(settings.maxEpisodesInjected) || 3;
    const selectedEpisodes = [];
    const seenSpans = new Set();

    for (const entry of scoredEpisodes) {
        const spanKey = `${entry.item.messageStart}:${entry.item.messageEnd}`;
        if (seenSpans.has(spanKey)) continue;
        seenSpans.add(spanKey);
        selectedEpisodes.push(entry.item);
        if (selectedEpisodes.length >= maxEpisodes) break;
    }

    return {
        sceneCard: scoredSceneCard?.item || null,
        episodes: selectedEpisodes,
    };
}
