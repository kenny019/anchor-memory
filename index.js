import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { clearExtensionPrompt, getSettings, initializeSettings, setSettings } from './core/settings.js';
import { getChatState, saveChatState, ensureChatState, getActiveChatId } from './core/storage.js';
import { registerEventHooks } from './runtime/event-hooks.js';
import { runGenerationInterceptor } from './runtime/generation-hook.js';
import { processCompletedTurn } from './runtime/postgen-hook.js';
import { renderPanel } from './ui/panel.js';
import { registerSlashCommands } from './commands/slash.js';
import { consolidateEpisodes, applyConsolidation } from './writing/consolidate-episodes.js';
import { createLLMCaller } from './llm/api.js';
import { registerMemoryTool, unregisterMemoryTool } from './tools/memory-tool.js';

export const EXTENSION_NAME = 'anchor-memory';
export const EXTENSION_FOLDER = `third-party/${EXTENSION_NAME}`;
let initialized = false;

export async function initAnchorMemory() {
    if (initialized) {
        renderPanel(getSettings());
        return getSettings();
    }
    initialized = true;

    initializeSettings();
    const settings = getSettings();
    registerEventHooks({
        onBeforeGenerate: runGenerationInterceptor,
        onAfterGenerate: processCompletedTurn,
    });

    if (!document.getElementById('anchor_memory_settings')) {
        const settingsHtml = $(await renderExtensionTemplateAsync(EXTENSION_FOLDER, 'settings'));
        $('#extensions_settings').append(settingsHtml);
    }
    renderPanel(settings);
    bindUi();
    bindRuntimeEvents();
    registerSlashCommands();
    ensureActiveChatState();

    if (settings.memoryToolEnabled) {
        registerMemoryTool();
    }

    if (typeof window !== 'undefined') {
        window.AnchorMemory = {
            clearPrompt: () => clearExtensionPrompt(),
            getChatState,
            getSettings,
            initAnchorMemory,
            processCompletedTurn,
            saveChatState,
            setSettings,
        };
    }

    return settings;
}

function bindUi() {
    const settings = getSettings();
    $('#am_enabled').prop('checked', settings.enabled);
    $('#am_preserve_recent_messages').val(settings.preserveRecentMessages);
    $('#am_max_episodes').val(settings.maxEpisodesInjected);
    $('#am_scene_threshold').val(settings.sceneMessageThreshold);
    $('#am_prompt_position').val(settings.promptPosition);
    $('#am_prompt_depth').val(settings.promptDepth);
    $('#am_memory_format').val(settings.memoryFormat);

    $('#am_enabled').off('change').on('change', function () {
        updateSettings({ enabled: $(this).prop('checked') });
        if (!$(this).prop('checked')) {
            clearExtensionPrompt();
            renderPanel(getSettings());
        }
    });

    $('#am_preserve_recent_messages').off('input').on('input', function () {
        updateSettings({ preserveRecentMessages: toPositiveInt($(this).val(), 12) });
    });

    $('#am_max_episodes').off('input').on('input', function () {
        updateSettings({ maxEpisodesInjected: toPositiveInt($(this).val(), 3) });
    });

    $('#am_scene_threshold').off('input').on('input', function () {
        updateSettings({ sceneMessageThreshold: toPositiveInt($(this).val(), 14) });
    });

    $('#am_prompt_position').off('change').on('change', function () {
        updateSettings({ promptPosition: String($(this).val() || 'in_chat') });
    });

    $('#am_prompt_depth').off('input').on('input', function () {
        updateSettings({ promptDepth: toPositiveInt($(this).val(), 1) });
    });
    $('#am_memory_format').off('change').on('change', function () {
        updateSettings({ memoryFormat: String($(this).val() || 'text') });
    });

    // Windowed extraction
    $('#am_windowed_extraction').prop('checked', settings.windowedExtraction);
    $('#am_extraction_window_size').val(settings.extractionWindowSize);
    $('#am_extraction_window_overlap').val(settings.extractionWindowOverlap);

    $('#am_windowed_extraction').off('change').on('change', function () {
        updateSettings({ windowedExtraction: $(this).prop('checked') });
    });
    $('#am_extraction_window_size').off('input').on('input', function () {
        updateSettings({ extractionWindowSize: toPositiveInt($(this).val(), 8) });
    });
    $('#am_extraction_window_overlap').off('input').on('input', function () {
        updateSettings({ extractionWindowOverlap: toPositiveInt($(this).val(), 3) });
    });

    // LLM settings
    $('#am_memory_model_source').val(settings.memoryModelSource);
    $('#am_memory_model').val(settings.memoryModel);
    $('#am_llm_consolidation').prop('checked', settings.llmConsolidation);
    $('#am_auto_consolidation').prop('checked', settings.autoConsolidation);
    $('#am_consolidation_threshold').val(settings.consolidationThreshold);
    $('#am_llm_reranking').prop('checked', settings.llmReranking);
    $('#am_rerank_candidate_count').val(settings.rerankCandidateCount);
    $('#am_memory_tool_enabled').prop('checked', settings.memoryToolEnabled);

    $('#am_memory_model_source').off('input').on('input', function () {
        updateSettings({ memoryModelSource: String($(this).val() || '') });
    });
    $('#am_memory_model').off('input').on('input', function () {
        updateSettings({ memoryModel: String($(this).val() || '') });
    });
    // LLM summarization
    $('#am_llm_summarization').prop('checked', settings.llmSummarization);
    $('#am_llm_summarization').off('change').on('change', function () {
        updateSettings({ llmSummarization: $(this).prop('checked') });
    });

    $('#am_llm_consolidation').off('change').on('change', function () {
        updateSettings({ llmConsolidation: $(this).prop('checked') });
    });
    $('#am_auto_consolidation').off('change').on('change', function () {
        updateSettings({ autoConsolidation: $(this).prop('checked') });
    });
    $('#am_consolidation_threshold').off('input').on('input', function () {
        updateSettings({ consolidationThreshold: toPositiveInt($(this).val(), 60) });
    });

    // Hierarchical consolidation
    $('#am_max_consolidation_depth').val(settings.maxConsolidationDepth);
    $('#am_consolidation_fanout').val(settings.consolidationFanout);
    $('#am_max_consolidation_depth').off('input').on('input', function () {
        updateSettings({ maxConsolidationDepth: toPositiveInt($(this).val(), 3) });
    });
    $('#am_consolidation_fanout').off('input').on('input', function () {
        updateSettings({ consolidationFanout: toPositiveInt($(this).val(), 4) });
    });

    // Archived search
    $('#am_archived_search_enabled').prop('checked', settings.archivedSearchEnabled);
    $('#am_archived_score_penalty').val(settings.archivedScorePenalty);
    $('#am_archived_max_results').val(settings.archivedMaxResults);
    $('#am_archived_search_enabled').off('change').on('change', function () {
        updateSettings({ archivedSearchEnabled: $(this).prop('checked') });
    });
    $('#am_archived_score_penalty').off('input').on('input', function () {
        const val = parseFloat($(this).val());
        updateSettings({ archivedScorePenalty: Number.isFinite(val) ? Math.max(0, Math.min(1, val)) : 0.5 });
    });
    $('#am_archived_max_results').off('input').on('input', function () {
        updateSettings({ archivedMaxResults: toPositiveInt($(this).val(), 2) });
    });
    // RLM retrieval
    $('#am_llm_retrieval').prop('checked', settings.llmRetrieval);
    $('#am_retrieval_chunk_size').val(settings.retrievalChunkSize);

    $('#am_llm_retrieval').off('change').on('change', function () {
        updateSettings({ llmRetrieval: $(this).prop('checked') });
    });
    $('#am_retrieval_chunk_size').off('input').on('input', function () {
        updateSettings({ retrievalChunkSize: toPositiveInt($(this).val(), 10) });
    });

    $('#am_llm_reranking').off('change').on('change', function () {
        updateSettings({ llmReranking: $(this).prop('checked') });
    });
    $('#am_rerank_candidate_count').off('input').on('input', function () {
        updateSettings({ rerankCandidateCount: toPositiveInt($(this).val(), 8) });
    });
    $('#am_memory_tool_enabled').off('change').on('change', function () {
        const enabled = $(this).prop('checked');
        updateSettings({ memoryToolEnabled: enabled });
        if (enabled) {
            registerMemoryTool();
        } else {
            unregisterMemoryTool();
        }
    });

    $('#am_consolidate_now').off('click').on('click', async function () {
        const btn = $(this);
        btn.prop('disabled', true).text('Consolidating...');
        try {
            const settings = getSettings();
            const chatId = getActiveChatId();
            const chatState = getChatState(chatId);
            const llmCallFn = createLLMCaller(settings);
            const maxDepth = Number(settings.maxConsolidationDepth) || 3;
            const result = await consolidateEpisodes({ chatState, llmCallFn, settings, maxDepth });
            if (result.archivedIds.length > 0) {
                const nextState = applyConsolidation(chatState, result);
                saveChatState(chatId, nextState);
                btn.text(`Done: ${result.archivedIds.length} → ${result.newEpisodes.length}`);
            } else {
                btn.text('No clusters found');
            }
        } catch (err) {
            btn.text('Failed');
            console.warn('[AnchorMemory] Consolidation error:', err);
        }
        renderPanel(getSettings());
        setTimeout(() => btn.prop('disabled', false).text('Consolidate Now'), 3000);
    });
}

function bindRuntimeEvents() {
    eventSource.on(event_types.CHAT_CHANGED, () => {
        ensureActiveChatState();
        renderPanel(getSettings());
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, async (_messageId, type) => {
        await processCompletedTurn({ type });
        renderPanel(getSettings());
    });

    eventSource.on(event_types.GENERATION_STOPPED, () => {
        if (!getSettings().enabled) {
            clearExtensionPrompt();
        }
    });
}

function ensureActiveChatState() {
    ensureChatState(getActiveChatId());
}

function updateSettings(next) {
    setSettings(next);
    saveSettingsDebounced();
    renderPanel(getSettings());
}

function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.round(parsed);
}

if (typeof window !== 'undefined') {
    window.AnchorMemoryBootstrap = initAnchorMemory;
    window.anchor_memory_intercept = (...args) => runGenerationInterceptor(...args);
}

jQuery(async () => {
    await initAnchorMemory();
});
