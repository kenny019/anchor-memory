export function formatMemoryBlock({
    sceneCard = null,
    episodes = [],
    maxChars = 4000,
    format = 'text',
} = {}) {
    if (format === 'xml') {
        return formatXml({ sceneCard, episodes, maxChars });
    }
    return formatText({ sceneCard, episodes, maxChars });
}

// --- Text format (original) ---

function formatText({ sceneCard, episodes, maxChars }) {
    const sceneLines = buildSceneLines(sceneCard);
    const hasScene = sceneLines.length > 0;
    const header = '[Anchor Memory]';
    const sceneSection = `[Current Scene State]\n${hasScene ? sceneLines.join('\n') : '- None'}`;

    if (!hasScene && episodes.length === 0) {
        return '';
    }

    let block = `${header}\n\n${sceneSection}\n\n[Relevant Past Events]\n- None`;
    const formattedEpisodes = [];

    for (const [index, episode] of episodes.entries()) {
        const nextEpisode = formatEpisodeText(episode, index);
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

function formatEpisodeText(episode, index) {
    const tags = episode.tags?.length ? ` [${episode.tags.slice(0, 3).join(', ')}]` : '';
    return `${index + 1}. ${truncate(episode.title, 100)}${tags}\n${truncate(episode.summary, 320)}`;
}

// --- XML format ---

function formatXml({ sceneCard, episodes, maxChars }) {
    const sceneXml = buildSceneXml(sceneCard);
    const hasScene = sceneXml.length > 0;

    if (!hasScene && episodes.length === 0) {
        return '';
    }

    const sceneBlock = hasScene ? `<scene>\n${sceneXml}\n</scene>` : '<scene/>';
    let block = `<anchor_memory>\n${sceneBlock}\n<events/>\n</anchor_memory>`;
    const formattedEpisodes = [];

    for (const episode of episodes) {
        const nextEpisode = formatEpisodeXml(episode);
        const candidateEpisodes = [...formattedEpisodes, nextEpisode].join('\n');
        const candidateBlock = `<anchor_memory>\n${sceneBlock}\n<events>\n${candidateEpisodes}\n</events>\n</anchor_memory>`;
        if (candidateBlock.length > maxChars && formattedEpisodes.length > 0) {
            break;
        }
        if (candidateBlock.length > maxChars) {
            block = `<anchor_memory>\n${sceneBlock}\n<events/>\n</anchor_memory>`;
            break;
        }
        formattedEpisodes.push(nextEpisode);
        block = candidateBlock;
    }

    return block;
}

function buildSceneXml(sceneCard) {
    if (!sceneCard) return '';
    const lines = [];
    if (sceneCard.location) lines.push(`<location>${escXml(truncate(sceneCard.location, 120))}</location>`);
    if (sceneCard.timeContext) lines.push(`<time>${escXml(truncate(sceneCard.timeContext, 120))}</time>`);
    if (sceneCard.activeGoal) lines.push(`<goal>${escXml(truncate(sceneCard.activeGoal, 160))}</goal>`);
    if (sceneCard.activeConflict) lines.push(`<conflict>${escXml(truncate(sceneCard.activeConflict, 160))}</conflict>`);
    if (sceneCard.participants?.length) lines.push(`<participants>${escXml(sceneCard.participants.join(', '))}</participants>`);
    if (sceneCard.openThreads?.length) lines.push(`<open_threads>${escXml(sceneCard.openThreads.map(t => truncate(t, 80)).join(' | '))}</open_threads>`);
    return lines.join('\n');
}

function formatEpisodeXml(episode) {
    const sig = episode.significance != null ? ` significance="${episode.significance}"` : '';
    const tags = episode.tags?.length ? ` tags="${escXml(episode.tags.slice(0, 3).join(', '))}"` : '';
    const title = `<title>${escXml(truncate(episode.title, 100))}</title>`;
    const summary = `<summary>${escXml(truncate(episode.summary, 320))}</summary>`;
    return `<event${sig}${tags}>\n${title}\n${summary}\n</event>`;
}

// --- Shared helpers ---

function buildSceneLines(sceneCard) {
    const lines = [];
    if (sceneCard?.location) lines.push(`- Location: ${truncate(sceneCard.location, 120)}`);
    if (sceneCard?.timeContext) lines.push(`- Time: ${truncate(sceneCard.timeContext, 120)}`);
    if (sceneCard?.activeGoal) lines.push(`- Goal: ${truncate(sceneCard.activeGoal, 160)}`);
    if (sceneCard?.activeConflict) lines.push(`- Conflict: ${truncate(sceneCard.activeConflict, 160)}`);
    if (sceneCard?.participants?.length) lines.push(`- Participants: ${sceneCard.participants.join(', ')}`);
    if (sceneCard?.openThreads?.length) lines.push(`- Open Threads: ${sceneCard.openThreads.map(t => truncate(t, 80)).join(' | ')}`);
    return lines;
}

function escXml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text, maxLength) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 3)}...`;
}
