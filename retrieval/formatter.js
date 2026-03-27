export function formatMemoryBlock({
    sceneCard = null,
    episodes = [],
    dossiers = [],
    maxChars = 4000,
    format = 'text',
} = {}) {
    if (format === 'xml') {
        return formatXml({ sceneCard, episodes, dossiers, maxChars });
    }
    return formatText({ sceneCard, episodes, dossiers, maxChars });
}

export function formatToolResult({
    sceneCard = null,
    episodes = [],
    dossiers = [],
    maxChars = 6000,
} = {}) {
    const sections = [];

    // Scene
    const sceneLines = buildSceneLines(sceneCard);
    if (sceneLines.length > 0) {
        sections.push(`## Current Scene\n${sceneLines.join('\n')}`);
    }

    // Characters
    const charLines = buildDossierLinesText(dossiers);
    if (charLines.length > 0) {
        sections.push(`## Characters\n${charLines.join('\n')}`);
    }

    // Episodes
    if (episodes.length > 0) {
        const epBlocks = [];
        for (const [i, ep] of episodes.entries()) {
            const lines = [`### ${i + 1}. ${ep.title || 'Untitled'}`];
            const meta = [];
            if (ep.significance != null) meta.push(`Significance: ${ep.significance}`);
            if (ep.tags?.length) meta.push(`Tags: ${ep.tags.join(', ')}`);
            if (meta.length) lines.push(meta.join(' | '));
            if (ep.summary) lines.push(ep.summary);
            if (ep.keyFacts?.length) {
                lines.push('Key Facts:');
                for (const fact of ep.keyFacts) lines.push(`- ${fact}`);
            }
            epBlocks.push(lines.join('\n'));
        }
        sections.push(`## Matched Memories (${episodes.length} result${episodes.length !== 1 ? 's' : ''})\n\n${epBlocks.join('\n\n')}`);
    }

    if (sections.length === 0) return '';
    const result = sections.join('\n\n');
    if (result.length > maxChars) return result.slice(0, maxChars);
    return result;
}

// --- Text format ---

function formatText({ sceneCard, episodes, dossiers, maxChars }) {
    const sceneLines = buildSceneLines(sceneCard);
    const hasScene = sceneLines.length > 0;
    const header = '[Anchor Memory]';
    const sceneSection = `[Current Scene State]\n${hasScene ? sceneLines.join('\n') : '- None'}`;

    const dossierLines = buildDossierLinesText(dossiers);
    const dossierSection = dossierLines.length > 0 ? `[Active Characters]\n${dossierLines.join('\n')}` : '';

    if (!hasScene && episodes.length === 0 && !dossierSection) {
        return '';
    }

    const baseParts = [header, '', sceneSection];
    if (dossierSection) {
        // Budget check: soft-cap dossier section
        const sceneLen = `${header}\n\n${sceneSection}`.length;
        const available = maxChars - sceneLen;
        const softCap = dossiers.length <= 3 ? available * 0.5 : available * 0.25;
        if (dossierSection.length <= softCap || dossierSection.length <= 200) {
            baseParts.push('', dossierSection);
        } else {
            baseParts.push('', dossierSection.slice(0, Math.max(200, Math.floor(softCap))));
        }
    }

    const prefix = baseParts.join('\n');
    const noneBlock = `${prefix}\n\n[Relevant Past Events]\n- None`;
    let block = noneBlock;
    let episodesJoined = '';

    for (const [index, episode] of episodes.entries()) {
        const nextEpisode = formatEpisodeText(episode, index);
        const candidate = episodesJoined ? `${episodesJoined}\n\n${nextEpisode}` : nextEpisode;
        const candidateBlock = `${prefix}\n\n[Relevant Past Events]\n${candidate}`;
        if (candidateBlock.length > maxChars && episodesJoined) {
            break;
        }
        if (candidateBlock.length > maxChars) {
            block = noneBlock;
            break;
        }
        episodesJoined = candidate;
        block = candidateBlock;
    }

    return block;
}

function formatEpisodeText(episode, index) {
    const tags = episode.tags?.length ? ` [${episode.tags.slice(0, 3).join(', ')}]` : '';
    const facts = episode.keyFacts?.length ? `\nKey: ${truncate(episode.keyFacts.join('; '), 500)}` : '';
    return `${index + 1}. ${truncate(episode.title, 100)}${tags}\n${truncate(episode.summary, 500)}${facts}`;
}

// --- XML format ---

function formatXml({ sceneCard, episodes, dossiers, maxChars }) {
    const sceneXml = buildSceneXml(sceneCard);
    const hasScene = sceneXml.length > 0;
    const dossierXml = buildDossierXml(dossiers);

    if (!hasScene && episodes.length === 0 && !dossierXml) {
        return '';
    }

    const sceneBlock = hasScene ? `<scene>\n${sceneXml}\n</scene>` : '<scene/>';
    const charBlock = dossierXml ? `\n${dossierXml}\n` : '';

    const xmlPrefix = `<anchor_memory>\n${sceneBlock}${charBlock}`;
    const noneBlock = `${xmlPrefix}\n<events/>\n</anchor_memory>`;
    let block = noneBlock;
    let eventsJoined = '';

    for (const episode of episodes) {
        const nextEpisode = formatEpisodeXml(episode);
        const candidate = eventsJoined ? `${eventsJoined}\n${nextEpisode}` : nextEpisode;
        const candidateBlock = `${xmlPrefix}\n<events>\n${candidate}\n</events>\n</anchor_memory>`;
        if (candidateBlock.length > maxChars && eventsJoined) {
            break;
        }
        if (candidateBlock.length > maxChars) {
            block = noneBlock;
            break;
        }
        eventsJoined = candidate;
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
    if (sceneCard.openThreads?.length) lines.push(`<open_threads>${escXml(sceneCard.openThreads.map(t => truncate(t, 120)).join(' | '))}</open_threads>`);
    return lines.join('\n');
}

function formatEpisodeXml(episode) {
    const sig = episode.significance != null ? ` significance="${episode.significance}"` : '';
    const tags = episode.tags?.length ? ` tags="${escXml(episode.tags.slice(0, 3).join(', '))}"` : '';
    const title = `<title>${escXml(truncate(episode.title, 100))}</title>`;
    const summary = `<summary>${escXml(truncate(episode.summary, 500))}</summary>`;
    const facts = episode.keyFacts?.length ? `\n<key_facts>${escXml(truncate(episode.keyFacts.join('; '), 500))}</key_facts>` : '';
    return `<event${sig}${tags}>\n${title}\n${summary}${facts}\n</event>`;
}

function buildDossierXml(dossiers) {
    if (!Array.isArray(dossiers) || dossiers.length === 0) return '';
    const entries = dossiers.map(d => {
        const attrs = [`name="${escXml(d.name || '')}"`];
        if (d.aliases?.length) attrs.push(`aliases="${escXml(d.aliases.join(', '))}"`);
        const inner = [];
        if (d.relationship) inner.push(`<relationship>${escXml(d.relationship)}</relationship>`);
        if (d.emotionalState) inner.push(`<mood>${escXml(d.emotionalState)}</mood>`);
        if (d.goals) inner.push(`<goals>${escXml(d.goals)}</goals>`);
        if (d.knownInfo?.length) inner.push(`<known>${escXml(d.knownInfo.join('; '))}</known>`);
        if (d.traits?.length) inner.push(`<traits>${escXml(d.traits.join(', '))}</traits>`);
        return `<character ${attrs.join(' ')}>\n${inner.join('\n')}\n</character>`;
    });
    return `<characters>\n${entries.join('\n')}\n</characters>`;
}

// --- Shared helpers ---

function buildSceneLines(sceneCard) {
    const lines = [];
    if (sceneCard?.location) lines.push(`- Location: ${truncate(sceneCard.location, 120)}`);
    if (sceneCard?.timeContext) lines.push(`- Time: ${truncate(sceneCard.timeContext, 120)}`);
    if (sceneCard?.activeGoal) lines.push(`- Goal: ${truncate(sceneCard.activeGoal, 160)}`);
    if (sceneCard?.activeConflict) lines.push(`- Conflict: ${truncate(sceneCard.activeConflict, 160)}`);
    if (sceneCard?.participants?.length) lines.push(`- Participants: ${sceneCard.participants.join(', ')}`);
    if (sceneCard?.openThreads?.length) lines.push(`- Open Threads: ${sceneCard.openThreads.map(t => truncate(t, 120)).join(' | ')}`);
    return lines;
}

function buildDossierLinesText(dossiers) {
    if (!Array.isArray(dossiers) || dossiers.length === 0) return [];
    return dossiers.map(d => {
        const parts = [];
        const nameStr = d.name || 'Unknown';
        const aliasStr = d.aliases?.length ? ` (aka "${d.aliases.join('", "')}")` : '';
        parts.push(`- ${nameStr}${aliasStr}:`);
        if (d.relationship) parts.push(d.relationship);
        if (d.emotionalState) parts.push(d.emotionalState);
        if (d.traits?.length) parts.push(`Traits: ${d.traits.join(', ')}`);
        if (d.goals) parts.push(`Goals: ${d.goals}`);
        if (d.knownInfo?.length) parts.push(`Knows: ${d.knownInfo.join(', ')}`);
        return parts.join(' | ');
    });
}

function escXml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(text, maxLength) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 3)}...`;
}
