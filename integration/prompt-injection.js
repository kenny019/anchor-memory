export function createPromptPayload(memoryBlock, settings = {}) {
    return {
        depth: Number(settings.promptDepth) || 1,
        position: settings.promptPosition || 'in_chat',
        text: memoryBlock || '',
    };
}
