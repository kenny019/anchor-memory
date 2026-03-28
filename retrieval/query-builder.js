function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token && token.length > 2);
}

export function buildQueryContext({
    recentMessages = [],
    sceneCard = null,
} = {}) {
    const lastMsg = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;
    const currentMessageId = Number(lastMsg?.id) || 0;

    const recentText = recentMessages
        .slice(-3)
        .map(message => String(message?.text || message?.mes || ''))
        .join(' ');

    const normalizedSceneCard = sceneCard || {};
    const sceneParticipants = Array.isArray(normalizedSceneCard.participants) ? normalizedSceneCard.participants : [];
    const openThreads = Array.isArray(normalizedSceneCard.openThreads) ? normalizedSceneCard.openThreads : [];
    const stateText = [
        normalizedSceneCard.location,
        normalizedSceneCard.timeContext,
        normalizedSceneCard.activeGoal,
        normalizedSceneCard.activeConflict,
        ...sceneParticipants,
        ...openThreads,
    ].filter(Boolean).join(' ');

    const queryTerms = [...new Set(tokenize(recentText))];
    const terms = [...new Set([...queryTerms, ...tokenize(stateText)])];

    return {
        currentMessageId,
        location: String(normalizedSceneCard.location || ''),
        openThreads,
        queryTerms,
        recentText,
        sceneParticipants,
        stateText,
        terms,
    };
}
