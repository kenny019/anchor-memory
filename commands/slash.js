import { getContext } from '../../../../st-context.js';
import { clearExtensionPrompt, getSettings } from '../core/settings.js';
import { clearRetrievalSnapshot, getActiveChatId, getChatState, getRetrievalSnapshot, resetChatState, saveChatState } from '../core/storage.js';
import { hashText } from '../runtime/postgen-hook.js';
import { prepareGenerationMemory } from '../runtime/generation-hook.js';
import { hasEpisodeSpan, episodeStats, formatDepthInfo, capActiveEpisodes } from '../models/episodes.js';
import { buildEpisodeCandidate } from '../writing/build-episode.js';
import { consolidateEpisodes, applyConsolidation } from '../writing/consolidate-episodes.js';
import { createLLMCaller } from '../llm/api.js';

let registered = false;

function showDialog(title, content) {
    const id = 'anchor-memory-dialog';
    document.getElementById(id)?.remove();
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    const box = document.createElement('div');
    box.style.cssText = 'background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;border-radius:8px;padding:20px;max-width:700px;width:90%;max-height:80vh;overflow-y:auto;font-family:monospace;font-size:13px;white-space:pre-wrap;word-break:break-word';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #45475a';
    const titleEl = document.createElement('strong');
    titleEl.style.fontSize = '15px';
    titleEl.textContent = title;
    header.appendChild(titleEl);
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00D7';
    closeBtn.style.cssText = 'background:none;border:none;color:#cdd6f4;font-size:20px;cursor:pointer;padding:0 4px';
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);
    box.appendChild(header);
    box.appendChild(document.createTextNode(content));
    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

export function registerSlashCommands() {
    if (registered) return;
    registered = true;

    const context = getContext();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = context;

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'am-status',
        callback: async () => { const r = formatStatus(); showDialog('Anchor Memory Status', r); return r; },
        helpString: 'Show Anchor Memory status for the active chat.',
        returns: 'status text',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'am-retrieve',
        callback: async () => { const r = await previewRetrieval(); showDialog('Anchor Memory Retrieval', r); return r; },
        helpString: 'Preview the current Anchor Memory injection block.',
        returns: 'memory preview',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'am-scene',
        callback: async (_namedArgs, unnamedArg) => { const r = await forceSceneBoundary(String(unnamedArg || '').trim()); showDialog('Anchor Memory', r); return r; },
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
        name: 'am-consolidate',
        callback: async () => { const r = await runConsolidate(); showDialog('Anchor Memory', r); return r; },
        helpString: 'Consolidate old episodes into semantic memories using LLM.',
        returns: 'consolidation status',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'am-reset',
        callback: async () => { const r = resetMemory(); showDialog('Anchor Memory', r); return r; },
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

    const stats = episodeStats(chatState.episodes);
    const depthInfo = formatDepthInfo(stats.byDepth);

    return [
        'Anchor Memory Status',
        `chatId: ${chatState.chatId}`,
        `sceneCard: ${sceneLines.length > 0 ? sceneLines.join(' | ') : '(empty)'}`,
        `episodes: ${stats.active} active (${depthInfo || '0'}), ${stats.archived} archived`,
        `lastProcessedTurnKey: ${chatState.lastProcessedTurnKey || '(none)'}`,
        `lastEpisodeBoundaryMessageId: ${chatState.lastEpisodeBoundaryMessageId ?? '(none)'}`,
    ].join('\n');
}

async function previewRetrieval() {
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

    const prepared = await prepareGenerationMemory({
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

async function forceSceneBoundary(titleOverride = '') {
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

    const candidate = await buildEpisodeCandidate({
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
        episodes: capActiveEpisodes([...chatState.episodes, candidate]),
        lastEpisodeBoundaryMessageId: candidate.messageEnd,
    };
    saveChatState(chatId, nextState);

    return `Committed scene "${candidate.title}" (${candidate.messageStart}-${candidate.messageEnd}).`;
}

async function runConsolidate() {
    const settings = getSettings();
    const chatId = getActiveChatId();
    const chatState = getChatState(chatId);
    const activeEpisodes = (chatState.episodes || []).filter(ep => !ep.archived);

    if (activeEpisodes.length < 3) {
        return 'Not enough episodes to consolidate (need at least 3).';
    }

    const maxDepth = Number(settings.maxConsolidationDepth) || 3;
    const result = await consolidateEpisodes({ chatState, llmCallFn: createLLMCaller(settings), settings, maxDepth });

    if (result.archivedIds.length === 0) {
        return 'No clusters found for consolidation.';
    }

    const nextState = applyConsolidation(chatState, result);
    saveChatState(chatId, nextState);

    // Count distinct depths consolidated
    const depths = new Set(result.newEpisodes.map(ep => ep.depth || 1));
    return `Consolidated ${result.archivedIds.length} episodes across ${depths.size} depth(s) into ${result.newEpisodes.length} semantic memories.`;
}

function resetMemory() {
    const chatId = getActiveChatId();
    const context = getContext();
    const messages = (context.chat || []).filter(m => m && !m.is_system);

    resetChatState(chatId);

    // Stamp current turn key + boundary so processCompletedTurn skips old messages
    if (messages.length > 0) {
        const chatState = getChatState(chatId);
        const lastIdx = messages.length - 1;
        const lastAssistant = [...messages].reverse().find(m => !m.is_user);
        if (lastAssistant) {
            const assistantIdx = messages.indexOf(lastAssistant);
            chatState.lastProcessedTurnKey = `${assistantIdx}:${hashText(String(lastAssistant.mes || ''))}:normal`;
        }
        chatState.lastEpisodeBoundaryMessageId = lastIdx;
        saveChatState(chatId, chatState);
    }

    clearRetrievalSnapshot(chatId);
    clearExtensionPrompt();
    return `Reset Anchor Memory for chat "${chatId}".`;
}
