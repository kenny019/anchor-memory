import { getContext } from '../../../../st-context.js';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_TOKENS = 300;

export async function callMemoryLLM({
    prompt = '',
    systemPrompt = '',
    maxTokens = DEFAULT_MAX_TOKENS,
    settings = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const modelSource = settings.memoryModelSource || '';
    const modelId = settings.memoryModel || '';

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let text = null;
        try {
            text = await tryServiceCall({ prompt, systemPrompt, maxTokens, modelSource, modelId, signal: controller.signal });
        } catch (serviceError) {
            console.warn('[AnchorMemory] Service call failed, trying quiet prompt:', serviceError?.message);
            text = await tryQuietCall({ prompt, maxTokens });
        }

        clearTimeout(timer);
        return { text, error: null };
    } catch (error) {
        console.warn('[AnchorMemory] LLM call failed:', error?.message || error);
        return { text: null, error: String(error?.message || 'LLM call failed') };
    }
}

async function tryServiceCall({ prompt, systemPrompt, maxTokens, modelSource, modelId, signal }) {
    const context = getContext();
    const service = context?.ChatCompletionService;
    if (!service?.processRequest) {
        throw new Error('ChatCompletionService not available');
    }

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const requestData = {
        stream: false,
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
    };

    if (modelId) requestData.model = modelId;
    if (modelSource) requestData.chat_completion_source = modelSource;

    const result = await service.processRequest(requestData, {}, true, signal);
    console.info('[AnchorMemory] Service response type:', typeof result, result ? Object.keys(result).slice(0, 10) : result);
    if (typeof result === 'string') return result;
    if (result?.choices?.[0]?.message?.content) return result.choices[0].message.content;
    // Try other common response shapes
    if (result?.content) return result.content;
    if (result?.text) return result.text;
    if (result?.message?.content) return result.message.content;
    throw new Error('Unexpected response shape');
}

async function tryQuietCall({ prompt, maxTokens }) {
    const context = getContext();
    const generate = context?.generateQuietPrompt;
    if (typeof generate !== 'function') {
        throw new Error('No LLM API available');
    }

    console.info('[AnchorMemory] Using generateQuietPrompt fallback (no model override)');
    const result = await generate(prompt, false, false, null, null, maxTokens);
    return result || null;
}

export function createLLMCaller(settings, extraDefaults = {}) {
    return (args) => callMemoryLLM({ ...extraDefaults, ...args, settings });
}

export function isLLMAvailable() {
    const context = getContext();
    return Boolean(context?.ChatCompletionService?.processRequest || context?.generateQuietPrompt);
}
