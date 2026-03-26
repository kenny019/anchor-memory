export function selectMemoryItems({
    scoredSceneCard = null,
    scoredEpisodes = [],
    settings = {},
} = {}) {
    const maxEpisodes = Number(settings.maxEpisodesInjected) || 3;
    const maxArchived = Number(settings.archivedMaxResults) || 0;
    const activeSelected = [];
    const archivedSelected = [];
    const seenSpans = new Set();

    for (const entry of scoredEpisodes) {
        const spanKey = `${entry.item.messageStart}:${entry.item.messageEnd}`;
        if (seenSpans.has(spanKey)) continue;
        seenSpans.add(spanKey);

        if (entry.isArchived) {
            if (archivedSelected.length < maxArchived) {
                archivedSelected.push(entry.item);
            }
        } else {
            if (activeSelected.length < maxEpisodes) {
                activeSelected.push(entry.item);
            }
        }

        if (activeSelected.length >= maxEpisodes && archivedSelected.length >= maxArchived) break;
    }

    return {
        sceneCard: scoredSceneCard?.item || null,
        episodes: [...activeSelected, ...archivedSelected],
    };
}
