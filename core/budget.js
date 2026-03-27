export const DEFAULT_CANDIDATE_COUNT = 12;

export function computeEffectiveBudget(chatLength, configuredMax) {
    if (chatLength < 10) return Math.min(configuredMax, 2000);
    if (chatLength < 30) return Math.min(configuredMax, 3000);
    return configuredMax;
}
