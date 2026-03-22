import { event_types } from '../../../../../script.js';

const registeredHooks = [];

export function registerEventHooks(hooks = {}) {
    registeredHooks.length = 0;
    registeredHooks.push(hooks);
    return hooks;
}

export function getRegisteredHooks() {
    return [...registeredHooks];
}

export function getLifecycleEventNames() {
    return {
        chatChanged: event_types.CHAT_CHANGED,
        messageReceived: event_types.MESSAGE_RECEIVED,
        generationStopped: event_types.GENERATION_STOPPED,
    };
}
