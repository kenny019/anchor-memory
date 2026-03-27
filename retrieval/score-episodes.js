function overlapCount(values, terms) {
    const normalized = values.map(value => String(value || '').toLowerCase());
    return terms.reduce(
        (total, term) => total + normalized.some(value => value.includes(term)),
        0,
    );
}

export function scoreEpisodes(episodes, queryContext, { includeArchived = false, archivedPenalty = 0.5 } = {}) {
    const terms = queryContext?.terms || [];
    const participantTerms = queryContext?.sceneParticipants || [];
    const sceneLocation = String(queryContext?.location || '').toLowerCase();
    const openThreads = queryContext?.openThreads || [];
    const currentMsgId = Number(queryContext?.currentMessageId) || 0;

    return episodes
        .filter(episode => episode && (includeArchived || !episode.archived))
        .map(episode => {
            let score = 0;
            const reasons = [];
            score += overlapCount([episode.title, episode.summary, ...(episode.keyFacts || [])], terms) * 3;
            const participantScore = overlapCount(episode.participants || [], [...terms, ...participantTerms]);
            const locationScore = overlapCount(episode.locations || [], terms);
            const threadScore = overlapCount(episode.tags || [], [...terms, ...openThreads]);
            score += participantScore * 3;
            score += locationScore * 3;
            score += threadScore * 2;
            score += Number(episode.significance || 0);
            if (episode.pinned) score += 4;

            // Recency boost: recent episodes get up to +4, decaying over distance
            if (currentMsgId > 0) {
                const msgEnd = Number(episode.messageEnd) || 0;
                const distance = Math.max(0, currentMsgId - msgEnd);
                // +4 for current episode, decays to ~0 over 200 messages
                const recencyBoost = 4 * Math.exp(-distance / 60);
                score += recencyBoost;
                if (recencyBoost >= 2) reasons.push('recent');
            }

            if (participantScore > 0) reasons.push('participant_overlap');
            if (locationScore > 0 || (sceneLocation && overlapCount(episode.locations || [], [sceneLocation]) > 0)) reasons.push('location_overlap');
            if (threadScore > 0) reasons.push('thread_overlap');
            if (Number(episode.significance || 0) >= 4) reasons.push('high_significance');

            // Apply archived penalty
            const isArchived = Boolean(episode.archived);
            if (isArchived) score *= archivedPenalty;

            return {
                item: episode,
                reasons: reasons.length > 0 ? reasons : (score > 0 ? ['episode_match'] : []),
                score,
                isArchived,
            };
        })
        .sort((a, b) => b.score - a.score);
}
