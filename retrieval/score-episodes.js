function overlapCount(values, terms) {
    const normalized = values.map(value => String(value || '').toLowerCase());
    return terms.reduce(
        (total, term) => total + normalized.some(value => value.includes(term)),
        0,
    );
}

export function scoreEpisodes(episodes, queryContext) {
    const terms = queryContext?.terms || [];
    const participantTerms = queryContext?.sceneParticipants || [];
    const sceneLocation = String(queryContext?.location || '').toLowerCase();
    const openThreads = queryContext?.openThreads || [];

    return episodes
        .filter(episode => episode && !episode.archived)
        .map(episode => {
            let score = 0;
            const reasons = [];
            score += overlapCount([episode.title, episode.summary, ...(episode.keyFacts || [])], terms) * 2;
            const participantScore = overlapCount(episode.participants || [], [...terms, ...participantTerms]);
            const locationScore = overlapCount(episode.locations || [], terms);
            const threadScore = overlapCount(episode.tags || [], [...terms, ...openThreads]);
            score += participantScore * 5;
            score += locationScore * 3;
            score += threadScore * 2;
            score += Number(episode.significance || 0);
            if (episode.pinned) score += 4;
            if (participantScore > 0) reasons.push('participant_overlap');
            if (locationScore > 0 || (sceneLocation && overlapCount(episode.locations || [], [sceneLocation]) > 0)) reasons.push('location_overlap');
            if (threadScore > 0) reasons.push('thread_overlap');
            if (Number(episode.significance || 0) >= 4) reasons.push('high_significance');

            return {
                item: episode,
                reasons: reasons.length > 0 ? reasons : (score > 0 ? ['episode_match'] : []),
                score,
            };
        })
        .sort((a, b) => b.score - a.score);
}
