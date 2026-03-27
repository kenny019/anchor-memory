import { getContext } from '../../../../st-context.js';
import { clearExtensionPrompt, getSettings } from '../core/settings.js';
import { getMemoryInactiveReason, isMemoryConfigured } from '../core/memory-config.js';
import { normalizeChatMessages, getLatestAssistantMessage, buildTurnKey, resolveStoredMessageId, resolveStoredSpan } from '../core/messages.js';
import { clearRetrievalSnapshot, getActiveChatId, getChatState, getRetrievalSnapshot, resetChatState, saveChatState } from '../core/storage.js';
import { prepareGenerationMemory } from '../runtime/generation-hook.js';
import { createEpisode, hasEpisodeSpan, episodeStats, formatDepthInfo, capActiveEpisodes, pruneArchivedEpisodes } from '../models/episodes.js';
import { consolidateEpisodes, applyConsolidation } from '../writing/consolidate-episodes.js';
import { buildLLMEpisodeSummary } from '../writing/llm-summarizer.js';
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
    const settings = getSettings();
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
        `configured: ${isMemoryConfigured(settings) ? 'yes' : 'no'}`,
        !isMemoryConfigured(settings) ? `inactive: ${getMemoryInactiveReason(settings)}` : null,
        `sceneCard: ${sceneLines.length > 0 ? sceneLines.join(' | ') : '(empty)'}`,
        `episodes: ${stats.active} active (${depthInfo || '0'}), ${stats.archived} archived`,
        `lastProcessedTurnKey: ${chatState.lastProcessedTurnKey || '(none)'}`,
        `lastEpisodeBoundaryMessageId: ${chatState.lastEpisodeBoundaryMessageId ?? '(none)'}`,
    ].filter(Boolean).join('\n');
}

async function previewRetrieval() {
    const context = getContext();
    const settings = getSettings();
    if (!isMemoryConfigured(settings)) {
        return getMemoryInactiveReason(settings);
    }
    const chatState = getChatState(getActiveChatId());
    const allMessages = normalizeChatMessages(context.chat, context);
    const recentMessages = allMessages.slice(-(Number(settings.preserveRecentMessages) || 12));
    const configuredMax = Number(settings.maxInjectedChars) || 4000;
    const effectiveSettings = {
        ...settings,
        maxInjectedChars: allMessages.length < 30 ? Math.min(configuredMax, 2000) : configuredMax,
    };

    const prepared = await prepareGenerationMemory({
        chatState,
        recentMessages,
        allMessages,
        settings: effectiveSettings,
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
    const settings = getSettings();
    if (!isMemoryConfigured(settings)) {
        return getMemoryInactiveReason(settings);
    }
    const chatId = getActiveChatId();
    const chatState = getChatState(chatId);
    const context = getContext();
    const recentMessages = normalizeChatMessages(context.chat, context);
    const lastBoundary = resolveStoredMessageId(chatState.lastEpisodeBoundaryMessageId, recentMessages)
        ?? Number(chatState.lastEpisodeBoundaryMessageId ?? -1);
    const canonicalEpisodes = (chatState.episodes || []).map(episode => {
        const span = resolveStoredSpan(episode, recentMessages);
        return span ? { ...episode, messageStart: span.start, messageEnd: span.end } : episode;
    });
    const candidates = recentMessages.filter(message => Number(message.id) > lastBoundary);
    const summary = await buildLLMEpisodeSummary(candidates, chatState.sceneCard, createLLMCaller(settings));
    const candidate = summary && candidates.length > 0
        ? createEpisode({
            messageStart: Number(candidates[0].id),
            messageEnd: Number(candidates[candidates.length - 1].id),
            participants: chatState.sceneCard?.participants || [],
            locations: chatState.sceneCard?.location ? [chatState.sceneCard.location] : [],
            title: titleOverride || summary.title,
            summary: summary.summary,
            tags: summary.tags,
            significance: summary.significance,
            keyFacts: summary.keyFacts,
        })
        : null;

    if (!candidate) {
        return 'Unable to build a scene memory for the current chat state.';
    }

    if (hasEpisodeSpan(canonicalEpisodes, candidate.messageStart, candidate.messageEnd)) {
        return `Scene span ${candidate.messageStart}-${candidate.messageEnd} is already stored.`;
    }

    const nextState = {
        ...chatState,
        episodes: capActiveEpisodes([...canonicalEpisodes, candidate]),
        lastEpisodeBoundaryMessageId: candidate.messageEnd,
    };
    saveChatState(chatId, nextState);

    return `Committed scene "${candidate.title}" (${candidate.messageStart}-${candidate.messageEnd}).`;
}

async function runConsolidate() {
    const settings = getSettings();
    if (!isMemoryConfigured(settings)) {
        return getMemoryInactiveReason(settings);
    }
    const chatId = getActiveChatId();
    const chatState = getChatState(chatId);
    const activeEpisodes = (chatState.episodes || []).filter(ep => !ep.archived);
    const minClusterSize = Number(settings.consolidationFanout) || 4;

    if (activeEpisodes.length < minClusterSize) {
        return `Not enough episodes to consolidate (need at least ${minClusterSize}).`;
    }

    const maxDepth = Number(settings.maxConsolidationDepth) || 3;
    const result = await consolidateEpisodes({ chatState, llmCallFn: createLLMCaller(settings), settings, maxDepth });

    if (result.archivedIds.length === 0) {
        return 'No clusters found for consolidation.';
    }

    const nextState = applyConsolidation(chatState, result);
    nextState.episodes = pruneArchivedEpisodes(nextState.episodes, Number(settings.storageMaxArchived) || 200);
    saveChatState(chatId, nextState);

    // Count distinct depths consolidated
    const depths = new Set(result.newEpisodes.map(ep => ep.depth || 1));
    return `Consolidated ${result.archivedIds.length} episodes across ${depths.size} depth(s) into ${result.newEpisodes.length} semantic memories.`;
}

function resetMemory() {
    const chatId = getActiveChatId();
    const context = getContext();
    const messages = normalizeChatMessages(context.chat || [], context);

    resetChatState(chatId);

    // Stamp current turn key + boundary so processCompletedTurn skips old messages
    if (messages.length > 0) {
        const chatState = getChatState(chatId);
        const lastAssistant = getLatestAssistantMessage(messages);
        if (lastAssistant) {
            chatState.lastProcessedTurnKey = buildTurnKey(lastAssistant);
        }
        chatState.lastEpisodeBoundaryMessageId = messages[messages.length - 1].id;
        saveChatState(chatId, chatState);
    }

    clearRetrievalSnapshot(chatId);
    clearExtensionPrompt();
    return `Reset Anchor Memory for chat "${chatId}".`;
}
