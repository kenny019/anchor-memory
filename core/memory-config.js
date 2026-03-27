export function isMemoryConfigured(settings = {}) {
    return Boolean(
        String(settings.memoryModelSource || '').trim()
        && String(settings.memoryModel || '').trim(),
    );
}

export function getMemoryInactiveReason(settings = {}) {
    return isMemoryConfigured(settings) ? '' : 'Configure Model source and Model ID to enable memory.';
}
