export function formatMemoryBlock({
    sceneCard = null,
    episodes = [],
    maxChars = 4000,
} = {}) {
    const sceneLines = [];
    if (sceneCard?.location) sceneLines.push(`- Location: ${truncate(sceneCard.location, 120)}`);
    if (sceneCard?.timeContext) sceneLines.push(`- Time: ${truncate(sceneCard.timeContext, 120)}`);
    if (sceneCard?.activeGoal) sceneLines.push(`- Goal: ${truncate(sceneCard.activeGoal, 160)}`);
    if (sceneCard?.activeConflict) sceneLines.push(`- Conflict: ${truncate(sceneCard.activeConflict, 160)}`);
    if (sceneCard?.participants?.length) sceneLines.push(`- Participants: ${sceneCard.participants.join(', ')}`);
    if (sceneCard?.openThreads?.length) sceneLines.push(`- Open Threads: ${sceneCard.openThreads.map(thread => truncate(thread, 80)).join(' | ')}`);

    const hasScene = sceneLines.length > 0;
    const header = '[Anchor Memory]';
    const sceneSection = `[Current Scene State]\n${hasScene ? sceneLines.join('\n') : '- None'}`;

    if (!hasScene && episodes.length === 0) {
        return '';
    }

    let block = `${header}\n\n${sceneSection}\n\n[Relevant Past Events]\n- None`;
    const formattedEpisodes = [];

    for (const [index, episode] of episodes.entries()) {
        const nextEpisode = formatEpisode(episode, index);
        const candidateEpisodes = [...formattedEpisodes, nextEpisode].join('\n\n');
        const candidateBlock = `${header}\n\n${sceneSection}\n\n[Relevant Past Events]\n${candidateEpisodes}`;
        if (candidateBlock.length > maxChars && formattedEpisodes.length > 0) {
            break;
        }
        if (candidateBlock.length > maxChars) {
            block = `${header}\n\n${sceneSection}\n\n[Relevant Past Events]\n- None`;
            break;
        }
        formattedEpisodes.push(nextEpisode);
        block = candidateBlock;
    }

    return block;
}

function formatEpisode(episode, index) {
    const tags = episode.tags?.length ? ` [${episode.tags.slice(0, 3).join(', ')}]` : '';
    return `${index + 1}. ${truncate(episode.title, 100)}${tags}\n${truncate(episode.summary, 320)}`;
}

function truncate(text, maxLength) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 3)}...`;
}
