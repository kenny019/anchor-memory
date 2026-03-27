import { extension_prompt_types, setExtensionPrompt } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';

const EXTENSION_NAME = 'anchor-memory';
const PROMPT_KEY = 'anchor_memory_prompt';

const DEFAULT_SETTINGS = {
    enabled: true,
    preserveRecentMessages: 12,
    maxEpisodesInjected: 3,
    maxInjectedChars: 4000,
    promptPosition: 'in_chat',
    promptDepth: 1,

    // LLM infrastructure
    memoryModelSource: '',
    memoryModel: '',

    // Episode consolidation
    llmConsolidation: false,
    consolidationThreshold: 60,
    autoConsolidation: true,

    // Retrieval
    retrievalCandidateCount: 8,
    retrievalChunkSize: 10,
    rerankTimeoutMs: 5000,

    // Memory format
    memoryFormat: 'text',

    // Queryable memory tool
    memoryToolEnabled: false,

    // Hierarchical consolidation
    maxConsolidationDepth: 3,
    consolidationFanout: 4,
    maxAutoConsolidationDepth: 1,

    // Archived episode search
    archivedSearchEnabled: true,
    archivedScorePenalty: 0.5,
    archivedMaxResults: 2,
    storageMaxArchived: 200,
};

const DEPRECATED_SETTINGS = [
    'autoCreateEpisodes',
    'sceneMessageThreshold',
    'promptRole',
    'windowedExtraction',
    'extractionWindowSize',
    'extractionWindowOverlap',
    'llmReranking',
    'rerankCandidateCount',
    'llmSummarization',
    'llmRetrieval',
];

export function getDefaultSettings() {
    return structuredClone(DEFAULT_SETTINGS);
}

function ensureDefaults() {
    extension_settings[EXTENSION_NAME] = extension_settings[EXTENSION_NAME] || {};
    const settings = extension_settings[EXTENSION_NAME];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (settings[key] === undefined || settings[key] === null) {
            settings[key] = structuredClone(value);
        }
    }
    for (const key of DEPRECATED_SETTINGS) {
        delete settings[key];
    }
}

export function initializeSettings() {
    ensureDefaults();
    return structuredClone(extension_settings[EXTENSION_NAME]);
}

export function getSettings() {
    ensureDefaults();
    return structuredClone(extension_settings[EXTENSION_NAME]);
}

export function setSettings(nextSettings) {
    initializeSettings();
    Object.assign(extension_settings[EXTENSION_NAME], nextSettings || {});
    return getSettings();
}

export function getPromptKey() {
    return PROMPT_KEY;
}

export function clearExtensionPrompt() {
    const settings = getSettings();
    const position = settings.promptPosition === 'in_prompt'
        ? extension_prompt_types.IN_PROMPT
        : settings.promptPosition === 'before_prompt'
        ? extension_prompt_types.BEFORE_PROMPT
        : extension_prompt_types.IN_CHAT;
    setExtensionPrompt(PROMPT_KEY, '', position, Number(settings.promptDepth) || 1, false, 0);
}
