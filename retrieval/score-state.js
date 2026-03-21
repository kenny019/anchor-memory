function scoreField(text, terms) {
    const haystack = String(text || '').toLowerCase();
    return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
}

export function scoreSceneCard(sceneCard, queryContext) {
    const terms = queryContext?.terms || [];
    if (!sceneCard) return null;

    const parts = [
        sceneCard.location,
        sceneCard.timeContext,
        sceneCard.activeGoal,
        sceneCard.activeConflict,
        ...(sceneCard.participants || []),
        ...(sceneCard.openThreads || []),
    ].filter(Boolean);

    if (parts.length === 0) return null;

    let score = 1;
    score += scoreField(sceneCard.location, terms) * 3;
    score += scoreField(sceneCard.timeContext, terms);
    score += scoreField(sceneCard.activeGoal, terms) * 2;
    score += scoreField(sceneCard.activeConflict, terms) * 2;
    score += scoreField((sceneCard.participants || []).join(' '), terms) * 4;
    score += scoreField((sceneCard.openThreads || []).join(' '), terms) * 3;

    return {
        item: sceneCard,
        reasons: ['scene_state'],
        score,
    };
}
