import { getRetrievalSnapshot } from '../core/storage.js';
import { getSceneCardLines } from '../models/state-cards.js';
import { episodeStats } from '../models/episodes.js';

export function renderPanel(settings) {
    if (typeof document === 'undefined') return null;
    const chatState = typeof window !== 'undefined' && window.AnchorMemory?.getChatState
        ? window.AnchorMemory.getChatState()
        : null;
    const snapshot = getRetrievalSnapshot(chatState?.chatId);

    const statusEl = document.getElementById('am_status');
    if (statusEl) {
        const sceneLines = chatState ? getSceneCardLines(chatState.sceneCard) : [];
        statusEl.textContent = settings.enabled
            ? [
                `Chat: ${chatState?.chatId || '(none)'}`,
                `Episodes: ${(() => { const s = episodeStats(chatState?.episodes); return `${s.active} active, ${s.archived} archived, ${s.semantic} semantic`; })()}`,
                `Last Turn Key: ${chatState?.lastProcessedTurnKey || '(none)'}`,
                `Boundary: ${chatState?.lastEpisodeBoundaryMessageId ?? '(none)'}`,
                '',
                'Scene:',
                ...(sceneLines.length > 0 ? sceneLines.map(line => `- ${line}`) : ['- (empty)']),
            ].join('\n')
            : 'Anchor Memory loaded but disabled.';
    }

    const selectionEl = document.getElementById('am_last_selection');
    if (selectionEl) {
        selectionEl.textContent = snapshot
            ? [
                `Injected chars: ${snapshot.injectedChars}`,
                '',
                'Selected Scene:',
                ...(snapshot.selectedSceneLines.length > 0 ? snapshot.selectedSceneLines.map(line => `- ${line}`) : ['- None']),
                '',
                'Selected Episodes:',
                ...(snapshot.selectedEpisodes.length > 0
                    ? snapshot.selectedEpisodes.map(episode => `- ${episode.id}: ${episode.title} (${episode.span})`)
                    : ['- None']),
            ].join('\n')
            : '(none)';
    }

    const promptEl = document.getElementById('am_last_injection');
    if (promptEl) {
        promptEl.textContent = snapshot?.memoryBlock || '(none)';
    }

    return statusEl;
}
