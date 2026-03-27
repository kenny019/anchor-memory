export function normalizeChatMessages(chat = [], context = {}) {
    return (chat || [])
        .filter(message => message && !message.is_system)
        .map((message, index) => ({
            id: getCanonicalMessageId(message, index),
            legacyIndex: index,
            isUser: Boolean(message.is_user),
            isSystem: Boolean(message.is_system),
            name: String(message.name || (message.is_user ? context.name1 : context.name2) || ''),
            text: String(message.mes || ''),
        }));
}

export function getCanonicalMessageId(message, fallbackIndex = 0) {
    const parsed = Number(message?.messageId);
    if (Number.isFinite(parsed)) return parsed;
    return fallbackIndex;
}

export function buildTurnKey(message) {
    if (!message) return '';
    return `${message.id}:${hashText(message.text)}:normal`;
}

export function buildLegacyTurnKey(message) {
    if (!message) return '';
    return `${message.legacyIndex}:${hashText(message.text)}:normal`;
}

export function resolveStoredMessageId(storedId, messages = []) {
    const numericId = Number(storedId);
    if (!Number.isFinite(numericId)) return null;
    if (messages.some(message => message.id === numericId)) {
        return numericId;
    }
    if (numericId >= 0 && numericId < messages.length) {
        return messages[numericId]?.id ?? null;
    }
    return null;
}

export function resolveStoredSpan(episode, messages = []) {
    const start = resolveStoredMessageId(episode?.messageStart, messages);
    const end = resolveStoredMessageId(episode?.messageEnd, messages);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
        return null;
    }
    return { start, end };
}

export function getMessagesForStoredEpisode(allMessages = [], episode = null) {
    const span = resolveStoredSpan(episode, allMessages);
    if (!span) return [];
    return allMessages.filter(message => message.id >= span.start && message.id <= span.end);
}

export function getLatestAssistantMessage(messages = []) {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (!messages[index].isUser) {
            return messages[index];
        }
    }
    return null;
}

export function hashText(text) {
    let hash = 0;
    const value = String(text || '');
    for (let index = 0; index < value.length; index++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}
