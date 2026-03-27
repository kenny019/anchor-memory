import { extension_prompt_types, setExtensionPrompt } from '../../../../../script.js';
import { getContext } from '../../../../st-context.js';
import { getSettings, getPromptKey } from '../core/settings.js';
import { getChatState, getActiveChatId, setRetrievalSnapshot, clearRetrievalSnapshot } from '../core/storage.js';
import { isMemoryConfigured } from '../core/memory-config.js';
import { normalizeChatMessages } from '../core/messages.js';
import { createPromptPayload } from '../integration/prompt-injection.js';
import { createLLMCaller } from '../llm/api.js';
import { prepareGenerationMemoryData } from './prepare-memory.js';

export async function prepareGenerationMemory({
    chatState,
    recentMessages = [],
    allMessages = [],
    settings = {},
} = {}) {
    return prepareGenerationMemoryData({
        chatState,
        recentMessages,
        allMessages,
        settings,
        llmCallFn: createLLMCaller(settings, {
            timeoutMs: Number(settings.rerankTimeoutMs) || 5000,
        }),
    });
}

export async function buildGenerationMemoryBlock(args = {}) {
    return (await prepareGenerationMemory(args)).memoryBlock;
}

export async function runGenerationInterceptor(chat = [], _contextSize, _abort, type) {
    const settings = getSettings();
    if (!settings.enabled || !isMemoryConfigured(settings)) {
        clearGenerationArtifacts(settings);
        return;
    }

    if (type === 'quiet') {
        return;
    }

    const chatId = getActiveChatId();
    const chatState = getChatState(chatId);
    const preserveRecent = Number(settings.preserveRecentMessages) || 12;
    const allNormalized = normalizeChatMessages(chat, getContext());
    const recentMessages = allNormalized.slice(-preserveRecent);

    // Budget-aware: scale maxChars based on chat length as context proxy
    const configuredMax = Number(settings.maxInjectedChars) || 4000;
    const effectiveMax = chat.length < 30 ? Math.min(configuredMax, 2000) : configuredMax;
    const effectiveSettings = { ...settings, maxInjectedChars: effectiveMax };

    try {
        const prepared = await prepareGenerationMemory({
            chatState,
            recentMessages,
            allMessages: allNormalized,
            settings: effectiveSettings,
        });
        const memoryBlock = prepared.memoryBlock;

        const prompt = createPromptPayload(memoryBlock, settings);
        const queryText = recentMessages.map(message => message.text).join('\n').slice(0, 1000);
        if (!memoryBlock) {
            setExtensionPrompt(getPromptKey(), '', mapPromptPosition(prompt.position), prompt.depth, false, 0);
            setRetrievalSnapshot(chatId, {
                injectedChars: 0,
                memoryBlock: '',
                queryText,
                selectedEpisodes: [],
                selectedSceneLines: [],
            });
            return;
        }

        setExtensionPrompt(getPromptKey(), prompt.text, mapPromptPosition(prompt.position), prompt.depth, false, 0);
        setRetrievalSnapshot(chatId, {
            injectedChars: prompt.text.length,
            memoryBlock: prompt.text,
            queryText,
            selectedEpisodes: prepared.selected.episodes.map(episode => ({
                id: episode.id,
                title: episode.title,
                span: `${episode.messageStart}-${episode.messageEnd}`,
            })),
            selectedSceneLines: getSceneSnapshotLines(prepared.selected.sceneCard),
        });
    } catch (error) {
        console.warn('[AnchorMemory] Generation memory failed:', error?.message || error);
        clearGenerationArtifacts(settings);
    }
}

function mapPromptPosition(position) {
    if (position === 'in_prompt') return extension_prompt_types.IN_PROMPT;
    if (position === 'before_prompt') return extension_prompt_types.BEFORE_PROMPT;
    return extension_prompt_types.IN_CHAT;
}

function clearGenerationArtifacts(settings = {}) {
    const prompt = createPromptPayload('', settings);
    setExtensionPrompt(getPromptKey(), '', mapPromptPosition(prompt.position), prompt.depth, false, 0);
    clearRetrievalSnapshot(getActiveChatId());
}

function getSceneSnapshotLines(sceneCard) {
    if (!sceneCard) return [];
    const lines = [];
    if (sceneCard.location) lines.push(`Location: ${sceneCard.location}`);
    if (sceneCard.timeContext) lines.push(`Time: ${sceneCard.timeContext}`);
    if (sceneCard.activeGoal) lines.push(`Goal: ${sceneCard.activeGoal}`);
    if (sceneCard.activeConflict) lines.push(`Conflict: ${sceneCard.activeConflict}`);
    if (sceneCard.participants?.length) lines.push(`Participants: ${sceneCard.participants.join(', ')}`);
    if (sceneCard.openThreads?.length) lines.push(`Open Threads: ${sceneCard.openThreads.join(' | ')}`);
    return lines;
}
