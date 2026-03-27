import { getContext } from '../../../../st-context.js';
import { getSettings, clearExtensionPrompt } from '../core/settings.js';
import { isMemoryConfigured, getMemoryInactiveReason } from '../core/memory-config.js';
import { normalizeChatMessages, buildTurnKey, getLatestAssistantMessage } from '../core/messages.js';
import { getChatState, saveChatState, persistNow, getActiveChatId, resetAndStamp } from '../core/storage.js';
import { applyCharacterDeltas } from '../core/dossier-store.js';
import { capActiveEpisodes } from '../models/episodes.js';
import { createLLMCaller } from '../llm/api.js';
import { processChunk, CHUNK_SIZE } from './backfill-process.js';

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;

function showConfirmDialog(title, content) {
    return new Promise((resolve) => {
        const id = 'anchor-memory-confirm-dialog';
        document.getElementById(id)?.remove();

        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';

        const box = document.createElement('div');
        box.style.cssText = 'background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;border-radius:8px;padding:20px;max-width:500px;width:90%;font-family:monospace;font-size:13px;white-space:pre-wrap;word-break:break-word';

        const header = document.createElement('div');
        header.style.cssText = 'margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #45475a';
        const titleEl = document.createElement('strong');
        titleEl.style.fontSize = '15px';
        titleEl.textContent = title;
        header.appendChild(titleEl);
        box.appendChild(header);

        box.appendChild(document.createTextNode(content));

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:4px;padding:6px 16px;cursor:pointer;font-family:monospace';
        cancelBtn.onclick = () => { overlay.remove(); resolve(false); };

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Confirm';
        confirmBtn.style.cssText = 'background:#89b4fa;color:#1e1e2e;border:none;border-radius:4px;padding:6px 16px;cursor:pointer;font-weight:bold;font-family:monospace';
        confirmBtn.onclick = () => { overlay.remove(); resolve(true); };

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        box.appendChild(btnRow);
        overlay.appendChild(box);

        overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
        document.body.appendChild(overlay);
    });
}

async function runBackfillAsync(settings, allMessages) {
    const chatId = getActiveChatId();
    const lastAssistant = allMessages.length > 0 ? getLatestAssistantMessage(allMessages) : null;

    resetAndStamp(chatId, {
        lastProcessedTurnKey: lastAssistant ? buildTurnKey(lastAssistant) : '',
        lastEpisodeBoundaryMessageId: allMessages.length > 0 ? allMessages[allMessages.length - 1].id : null,
    });
    clearExtensionPrompt();

    // Split into chunks
    const chunks = [];
    for (let i = 0; i < allMessages.length; i += CHUNK_SIZE) {
        chunks.push(allMessages.slice(i, i + CHUNK_SIZE));
    }
    const totalChunks = chunks.length;
    const llmCallFn = createLLMCaller(settings);

    let chatState = getChatState(chatId);
    let totalEpisodes = 0;
    let totalFailures = 0;

    // Process in batches
    for (let batchStart = 0; batchStart < totalChunks; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, totalChunks);
        const batch = chunks.slice(batchStart, batchEnd);

        const results = await Promise.allSettled(
            batch.map((chunk, i) => processChunk(chunk, batchStart + i, totalChunks, llmCallFn)),
        );

        const newEpisodes = [];
        const allCharacters = [];

        for (const result of results) {
            if (result.status !== 'fulfilled' || !result.value) {
                totalFailures++;
                continue;
            }
            newEpisodes.push(result.value.episode);
            if (result.value.characters.length > 0) {
                allCharacters.push(...result.value.characters);
            }
        }

        if (newEpisodes.length > 0 || allCharacters.length > 0) {
            if (allCharacters.length > 0) {
                applyCharacterDeltas(chatId, allCharacters, {});
            }
            if (newEpisodes.length > 0) {
                chatState.episodes = capActiveEpisodes([...chatState.episodes, ...newEpisodes]);
            }
            saveChatState(chatId, chatState);
            await Promise.all([
                persistNow(chatId, 'state'),
                persistNow(chatId, 'dossiers'),
            ]);
        }

        totalEpisodes += newEpisodes.length;

        // Delay between batches (except after last)
        if (batchEnd < totalChunks) {
            await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
    }

    const msg = totalFailures > 0
        ? `Backfill complete: ${totalEpisodes} episodes from ${allMessages.length} messages (${totalFailures} chunk failures).`
        : `Backfill complete: ${totalEpisodes} episodes from ${allMessages.length} messages.`;
    toastr.success(msg, 'Anchor Memory');
}

export async function runBackfill() {
    const settings = getSettings();
    if (!isMemoryConfigured(settings)) {
        toastr.warning(getMemoryInactiveReason(settings), 'Anchor Memory');
        return '';
    }

    const context = getContext();
    const allMessages = normalizeChatMessages(context.chat || [], context);
    if (allMessages.length === 0) {
        toastr.warning('No messages in current chat.', 'Anchor Memory');
        return '';
    }

    const chunkCount = Math.ceil(allMessages.length / CHUNK_SIZE);
    const modelLabel = settings.memoryModel || 'unknown';

    const confirmed = await showConfirmDialog('Anchor Memory — Bulk Backfill', [
        `Messages: ${allMessages.length}`,
        `LLM calls: ${chunkCount * 2}`,
        `Model: ${modelLabel}`,
        '',
        'This will RESET all existing memory and',
        'rebuild from chat history.',
        '',
        'Continue?',
    ].join('\n'));

    if (!confirmed) return '';

    toastr.info(`Processing ${chunkCount} chunks in background...`, 'Anchor Memory');
    runBackfillAsync(settings, allMessages).catch(err => {
        console.error('[AnchorMemory] Backfill failed:', err);
        toastr.error(`Backfill failed: ${err?.message || err}`, 'Anchor Memory');
    });

    return '';
}
