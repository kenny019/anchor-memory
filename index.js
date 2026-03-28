import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { clearExtensionPrompt, getSettings, initializeSettings, setSettings } from './core/settings.js';
import { getChatState, saveChatState, ensureChatState, getActiveChatId, preloadChat } from './core/storage.js';
import { invalidateCache } from './core/localforage-store.js';
import { getAllDossiers, getDossier } from './core/dossier-store.js';
import { registerEventHooks } from './runtime/event-hooks.js';
import { runGenerationInterceptor } from './runtime/generation-hook.js';
import { processCompletedTurn } from './runtime/postgen-hook.js';
import { renderPanel } from './ui/panel.js';
import { registerSlashCommands } from './commands/slash.js';
import { registerMemoryTool, unregisterMemoryTool } from './tools/memory-tool.js';

export const EXTENSION_NAME = 'anchor-memory';
export const EXTENSION_FOLDER = `third-party/${EXTENSION_NAME}`;
let initialized = false;
let previousChatId = null;

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
    });

    if (!document.getElementById('anchor_memory_settings')) {
        const settingsHtml = $(await renderExtensionTemplateAsync(EXTENSION_FOLDER, 'settings'));
        $('#extensions_settings').append(settingsHtml);
    }
    const activeChatId = getActiveChatId();
    await preloadChat(activeChatId);
    previousChatId = activeChatId;

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
            getAllDossiers,
            getChatState,
            getDossier,
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
    $('#am_prompt_position').val(settings.promptPosition);
    $('#am_prompt_depth').val(settings.promptDepth);
    $('#am_memory_format').val(settings.memoryFormat);
    $('#am_memory_model_source').val(settings.memoryModelSource);
    $('#am_memory_model').val(settings.memoryModel);
    $('#am_llm_consolidation').prop('checked', settings.llmConsolidation);
    $('#am_memory_tool_enabled').prop('checked', settings.memoryToolEnabled);

    $('#am_enabled').off('change').on('change', function () {
        updateSettings({ enabled: $(this).prop('checked') });
        if (!$(this).prop('checked')) {
            clearExtensionPrompt();
            renderPanel(getSettings());
        }
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

    $('#am_memory_model_source').off('input').on('input', function () {
        updateSettings({ memoryModelSource: String($(this).val() || '') });
    });
    $('#am_memory_model').off('input').on('input', function () {
        updateSettings({ memoryModel: String($(this).val() || '') });
    });

    $('#am_llm_consolidation').off('change').on('change', function () {
        updateSettings({ llmConsolidation: $(this).prop('checked') });
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

    $('#am_debug_retrieval_logging').prop('checked', settings.debugRetrievalLogging);
    $('#am_debug_retrieval_logging').off('change').on('change', function () {
        updateSettings({ debugRetrievalLogging: $(this).prop('checked') });
    });
}

function bindRuntimeEvents() {
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        const newChatId = getActiveChatId();
        if (previousChatId && previousChatId !== newChatId) {
            invalidateCache(previousChatId);
        }
        await preloadChat(newChatId);
        previousChatId = newChatId;
        ensureActiveChatState();
        renderPanel(getSettings());
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
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
