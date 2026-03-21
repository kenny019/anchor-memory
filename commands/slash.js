import { getContext } from '../../../st-context.js';
import { clearExtensionPrompt, getSettings } from '../core/settings.js';
import { clearRetrievalSnapshot, getActiveChatId, getChatState, getRetrievalSnapshot, resetChatState, saveChatState } from '../core/storage.js';
import { prepareGenerationMemory } from '../runtime/generation-hook.js';
import { hasEpisodeSpan } from '../models/episodes.js';
import { buildEpisodeCandidate } from '../writing/build-episode.js';

let registered = false;

export function registerSlashCommands() {
    if (registered) return;
    registered = true;

    const context = getContext();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = context;

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'am-status',
        callback: async () => formatStatus(),
        helpString: 'Show Anchor Memory status for the active chat.',
        returns: 'status text',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'am-retrieve',
        callback: async () => previewRetrieval(),
        helpString: 'Preview the current Anchor Memory injection block.',
        returns: 'memory preview',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'am-scene',
        callback: async (_namedArgs, unnamedArg) => forceSceneBoundary(String(unnamedArg || '').trim()),
        helpString: 'Commit the current buffered scene into episode memory and start a new scene boundary.',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Optional scene title',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
            }),
        ],
        returns: 'episode status',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'am-reset',
        callback: async () => resetMemory(),
        helpString: 'Clear Anchor Memory metadata for the active chat and reinitialize empty state.',
        returns: 'reset status',
    }));
}

function formatStatus() {
    const chatState = getChatState(getActiveChatId());
    const sceneLines = [];
    if (chatState.sceneCard.location) sceneLines.push(`location=${chatState.sceneCard.location}`);
    if (chatState.sceneCard.timeContext) sceneLines.push(`time=${chatState.sceneCard.timeContext}`);
    if (chatState.sceneCard.activeGoal) sceneLines.push(`goal=${chatState.sceneCard.activeGoal}`);
    if (chatState.sceneCard.activeConflict) sceneLines.push(`conflict=${chatState.sceneCard.activeConflict}`);

    return [
        'Anchor Memory Status',
        `chatId: ${chatState.chatId}`,
        `sceneCard: ${sceneLines.length > 0 ? sceneLines.join(' | ') : '(empty)'}`,
        `episodes: ${chatState.episodes.length}`,
        `lastProcessedTurnKey: ${chatState.lastProcessedTurnKey || '(none)'}`,
        `lastEpisodeBoundaryMessageId: ${chatState.lastEpisodeBoundaryMessageId ?? '(none)'}`,
    ].join('\n');
}

function previewRetrieval() {
    const context = getContext();
    const settings = getSettings();
    const chatState = getChatState(getActiveChatId());
    const recentMessages = context.chat
        .filter(message => message && !message.is_system)
        .map((message, index) => ({
            id: index,
            isUser: Boolean(message.is_user),
            name: String(message.name || (message.is_user ? context.name1 : context.name2) || ''),
            text: String(message.mes || ''),
        }))
        .slice(-(Number(settings.preserveRecentMessages) || 12));

    const prepared = prepareGenerationMemory({
        chatState,
        recentMessages,
        settings,
    });

    const episodeSummary = prepared.selected.episodes.length > 0
        ? prepared.selected.episodes.map(episode => `- ${episode.id}: ${episode.title}`).join('\n')
        : '- None';

    return [
        'Selected Episodes:',
        episodeSummary,
        '',
        'Prompt Block:',
        prepared.memoryBlock || '(empty)',
    ].join('\n');
}

function forceSceneBoundary(titleOverride = '') {
    const chatId = getActiveChatId();
    const chatState = getChatState(chatId);
    const context = getContext();
    const recentMessages = context.chat
        .filter(message => message && !message.is_system)
        .map((message, index) => ({
            id: index,
            isUser: Boolean(message.is_user),
            name: String(message.name || (message.is_user ? context.name1 : context.name2) || ''),
            text: String(message.mes || ''),
        }));

    const candidate = buildEpisodeCandidate({
        chatState,
        recentMessages,
        settings: {
            ...getSettings(),
            sceneMessageThreshold: 1,
        },
        titleOverride,
        force: true,
    });

    if (!candidate) {
        return 'No scene content available to commit.';
    }

    if (hasEpisodeSpan(chatState.episodes, candidate.messageStart, candidate.messageEnd)) {
        return `Scene span ${candidate.messageStart}-${candidate.messageEnd} is already stored.`;
    }

    const nextState = {
        ...chatState,
        episodes: [...chatState.episodes, candidate].slice(-100),
        lastEpisodeBoundaryMessageId: candidate.messageEnd,
    };
    saveChatState(chatId, nextState);

    return `Committed scene "${candidate.title}" (${candidate.messageStart}-${candidate.messageEnd}).`;
}

function resetMemory() {
    const chatId = getActiveChatId();
    resetChatState(chatId);
    clearRetrievalSnapshot(chatId);
    clearExtensionPrompt();
    return `Reset Anchor Memory for chat "${chatId}".`;
}
