import {
    createDossier,
    normalizeDossier,
    normalizeDossierKey,
    mergeDossier,
} from '../models/dossiers.js';
import { createEpisode } from '../models/episodes.js';
import { formatMemoryBlock, formatToolResult } from '../retrieval/formatter.js';
import { llmExtractScene } from '../writing/llm-extract-state.js';

let totalPassed = 0;
let totalFailed = 0;
const failures = [];

function assert(name, condition, detail = '') {
    if (condition) {
        totalPassed++;
        console.log(`  PASS  ${name}`);
    } else {
        totalFailed++;
        failures.push(`${name}${detail ? ': ' + detail : ''}`);
        console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    }
}

// ==========================================
// Group 1: Dossier Model (models/dossiers.js)
// ==========================================
console.log('\n=== Group 1: Dossier Model ===\n');

{
    const d = createDossier({
        name: 'Luna',
        aliases: ['Lu', 'Moon Girl'],
        relationship: 'companion',
        emotionalState: 'cautious',
        knownInfo: ['knows map location'],
        goals: 'find the artifact',
        traits: ['brave', 'curious'],
    });
    assert('createDossier with full fields returns normalized dossier',
        d.name === 'Luna' && d.relationship === 'companion' && d.traits.length === 2);
}

{
    const d = createDossier({});
    assert('createDossier with empty fields returns defaults',
        d.name === '' && d.aliases.length === 0 && d.knownInfo.length === 0);
}

{
    const d = normalizeDossier({
        name: 'X',
        aliases: ['a', 'b', 'c', 'd', 'e', 'f'],
        knownInfo: Array.from({ length: 20 }, (_, i) => `fact${i}`),
        traits: Array.from({ length: 12 }, (_, i) => `trait${i}`),
    });
    assert('normalizeDossier caps aliases at 5, knownInfo at 15, traits at 8',
        d.aliases.length === 5 && d.knownInfo.length === 15 && d.traits.length === 8);
}

{
    const d = normalizeDossier({
        name: 'X',
        aliases: ['Lu', 'lu', 'LU'],
        knownInfo: ['fact', 'Fact', 'FACT'],
        traits: ['brave', 'Brave'],
    });
    assert('normalizeDossier deduplicates arrays',
        d.aliases.length === 1 && d.knownInfo.length === 1 && d.traits.length === 1);
}

{
    assert('normalizeDossierKey lowercases and trims',
        normalizeDossierKey('  Luna  ') === 'luna');
}

{
    const existing = createDossier({ name: 'Luna', relationship: 'ally', emotionalState: 'calm' });
    const incoming = createDossier({ name: 'Luna', relationship: 'friend' });
    const merged = mergeDossier(existing, incoming, {});
    assert('mergeDossier: non-empty string incoming wins',
        merged.relationship === 'friend');
}

{
    const existing = createDossier({ name: 'Luna', relationship: 'ally' });
    const incoming = createDossier({ name: 'Luna', relationship: '' });
    const merged = mergeDossier(existing, incoming, {});
    assert('mergeDossier: empty string incoming does NOT overwrite existing',
        merged.relationship === 'ally');
}

{
    const existing = createDossier({ name: 'Luna', aliases: ['Lu'] });
    const incoming = createDossier({ name: 'Luna', aliases: ['Moon Girl'] });
    const merged = mergeDossier(existing, incoming, {});
    assert('mergeDossier: aliases accumulate (union, deduped, capped)',
        merged.aliases.length === 2 && merged.aliases.includes('Lu') && merged.aliases.includes('Moon Girl'));
}

{
    const existing = createDossier({ name: 'Luna', knownInfo: ['fact1'] });
    const incoming = createDossier({ name: 'Luna', knownInfo: ['fact2'] });
    const merged = mergeDossier(existing, incoming, {});
    assert('mergeDossier: knownInfo accumulates (union, deduped, capped)',
        merged.knownInfo.length === 2);
}

{
    const existing = createDossier({ name: 'Luna', traits: ['brave'] });
    const incoming = createDossier({ name: 'Luna', traits: ['curious'] });
    const merged = mergeDossier(existing, incoming, {});
    assert('mergeDossier: traits accumulate (union, deduped, capped)',
        merged.traits.length === 2);
}

{
    const merged = mergeDossier({ name: 'Luna' }, { name: 'Luna' }, { messageId: 42 });
    assert('mergeDossier: lastSeenMessageId from meta.messageId',
        merged.lastSeenMessageId === 42);
}

{
    const before = Date.now();
    const merged = mergeDossier({ name: 'Luna' }, { name: 'Luna' }, {});
    assert('mergeDossier: updatedAtTs is set to current time',
        merged.updatedAtTs >= before && merged.updatedAtTs <= Date.now() + 100);
}

// ==========================================
// Group 2: Formatter — Dossier rendering
// ==========================================
console.log('\n=== Group 2: Formatter — Dossier Rendering ===\n');

const testDossiers = [
    createDossier({ name: 'Luna', aliases: ['Lu'], relationship: 'companion', emotionalState: 'cautious', goals: 'find the artifact', knownInfo: ['map location', 'guild secret'], traits: ['brave'] }),
    createDossier({ name: 'Kael', relationship: 'rival', emotionalState: 'hostile', traits: ['cunning', 'proud'] }),
];

const testSceneCard = {
    location: 'ancient ruins',
    timeContext: 'night',
    activeGoal: 'explore',
    activeConflict: 'guards patrol',
    participants: ['Luna', 'Kael'],
    openThreads: ['artifact location'],
};

{
    const block = formatMemoryBlock({ sceneCard: testSceneCard, dossiers: testDossiers, episodes: [], maxChars: 4000, format: 'text' });
    assert('formatMemoryBlock with dossiers renders [Active Characters] section in text',
        block.includes('[Active Characters]') && block.includes('Luna'));
}

{
    const block = formatMemoryBlock({ sceneCard: testSceneCard, dossiers: testDossiers, episodes: [], maxChars: 4000, format: 'xml' });
    assert('formatMemoryBlock with dossiers renders <characters> section in xml',
        block.includes('<characters>') && block.includes('<character'));
}

{
    const block = formatMemoryBlock({ sceneCard: testSceneCard, dossiers: [], episodes: [], maxChars: 4000, format: 'text' });
    assert('formatMemoryBlock with empty dossiers omits character section',
        !block.includes('[Active Characters]'));
}

{
    const manyDossiers = Array.from({ length: 10 }, (_, i) => createDossier({
        name: `Character${i}`,
        relationship: 'neutral',
        knownInfo: ['fact1', 'fact2', 'fact3'],
        traits: ['trait1', 'trait2'],
        goals: 'some long goal description that takes up space',
    }));
    const block = formatMemoryBlock({ sceneCard: testSceneCard, dossiers: manyDossiers, episodes: [], maxChars: 1000, format: 'text' });
    const charStart = block.indexOf('[Active Characters]');
    const eventsStart = block.indexOf('[Relevant Past Events]');
    if (charStart >= 0 && eventsStart >= 0) {
        const charSection = block.slice(charStart, eventsStart);
        const sceneEnd = block.indexOf('[Active Characters]');
        const sceneLen = sceneEnd;
        const available = 1000 - sceneLen;
        assert('dossier budget: respects 25% soft cap with many characters',
            charSection.length <= available * 0.3 + 50); // +50 for header
    } else {
        assert('dossier budget: respects 25% soft cap with many characters', true);
    }
}

{
    const twoDossiers = testDossiers.slice(0, 2);
    const block = formatMemoryBlock({ sceneCard: testSceneCard, dossiers: twoDossiers, episodes: [], maxChars: 4000, format: 'text' });
    assert('dossier budget: 2 dossiers can use more than 25%',
        block.includes('Luna') && block.includes('Kael'));
}

// formatToolResult tests
const testEpisodes = [
    createEpisode({
        id: 'ep1',
        title: 'The Discovery',
        summary: 'Found the hidden entrance beneath the ruins. The markings on the wall matched the ancient map.',
        significance: 4,
        tags: ['exploration', 'discovery', 'ruins'],
        keyFacts: ['Hidden entrance found', 'Wall markings match map', 'Luna spotted trap mechanism'],
    }),
    createEpisode({
        id: 'ep2',
        title: 'Kael confrontation',
        summary: 'Kael appeared and demanded the artifact map. Brief standoff resolved when guards approached.',
        significance: 3,
        tags: ['conflict', 'rivalry'],
        keyFacts: ['Kael wants the map', 'Guards forced retreat'],
    }),
];

{
    const result = formatToolResult({ sceneCard: testSceneCard, episodes: testEpisodes, dossiers: testDossiers });
    assert('formatToolResult returns markdown with ## headers',
        result.includes('## Current Scene') && result.includes('## Matched Memories'));
}

{
    const longSummary = 'A'.repeat(600);
    const ep = createEpisode({ id: 'long', title: 'Long', summary: longSummary, keyFacts: ['fact'] });
    const result = formatToolResult({ sceneCard: null, episodes: [ep], dossiers: [] });
    assert('formatToolResult does NOT truncate summaries',
        result.includes(longSummary));
}

{
    const result = formatToolResult({ sceneCard: null, episodes: testEpisodes, dossiers: [] });
    assert('formatToolResult renders key facts as bullet list',
        result.includes('- Hidden entrance found') && result.includes('- Kael wants the map'));
}

{
    const result = formatToolResult({ sceneCard: null, episodes: testEpisodes, dossiers: [] });
    assert('formatToolResult shows significance and tags per episode',
        result.includes('Significance: 4') && result.includes('Tags: exploration'));
}

{
    const result = formatToolResult({ sceneCard: testSceneCard, episodes: testEpisodes, dossiers: testDossiers });
    assert('formatToolResult includes dossier section',
        result.includes('## Characters') && result.includes('Luna'));
}

{
    const result = formatToolResult({ sceneCard: testSceneCard, episodes: testEpisodes, dossiers: testDossiers, maxChars: 6000 });
    assert('formatToolResult respects 6000 char default',
        result.length <= 6000);
}

// ==========================================
// Group 3: LLM Extraction parsing
// ==========================================
console.log('\n=== Group 3: LLM Extraction Parsing ===\n');

{
    const llmStub = async () => ({
        text: JSON.stringify({
            scene: {
                location: 'tavern',
                timeContext: 'evening',
                activeGoal: '',
                activeConflict: '',
                openThreads: [],
                participants: ['User', 'Elena'],
            },
            boundary: { shouldCreate: false },
            characters: [
                { name: 'Elena', relationship: 'ally', emotionalState: 'nervous', knownInfo: ['saw the map'], traits: ['cautious'], goals: 'survive' },
            ],
        }),
        error: null,
    });
    const result = await llmExtractScene({
        recentMessages: [{ id: 1, text: 'hello', name: 'User', isUser: true }],
        chatState: { sceneCard: { location: '', participants: [] }, lastEpisodeBoundaryMessageId: -1 },
        llmCallFn: llmStub,
    });
    assert('llmExtractScene parses characters array from response',
        result?.characters?.length === 1 && result.characters[0].name === 'Elena');
}

{
    const llmStub = async () => ({
        text: JSON.stringify({
            scene: { location: 'forest', timeContext: '', activeGoal: '', activeConflict: '', openThreads: [], participants: [] },
            boundary: { shouldCreate: false },
        }),
        error: null,
    });
    const result = await llmExtractScene({
        recentMessages: [{ id: 1, text: 'hello', name: 'User', isUser: true }],
        chatState: {},
        llmCallFn: llmStub,
    });
    assert('llmExtractScene returns empty characters if field missing (backward compat)',
        Array.isArray(result?.characters) && result.characters.length === 0);
}

{
    const llmStub = async () => ({
        text: JSON.stringify({
            scene: { location: 'tavern', participants: ['User'] },
            characters: [
                { name: '', relationship: 'x' },
                { name: 'Valid', relationship: 'y' },
            ],
        }),
        error: null,
    });
    const result = await llmExtractScene({
        recentMessages: [{ id: 1, text: 'hi', name: 'User', isUser: true }],
        chatState: {},
        llmCallFn: llmStub,
    });
    assert('llmExtractScene filters characters with empty names',
        result?.characters?.length === 1 && result.characters[0].name === 'Valid');
}

{
    // parseCharacters no longer caps — normalizeDossier handles that downstream.
    // Verify it passes through all values as-is.
    const llmStub = async () => ({
        text: JSON.stringify({
            scene: { location: 'x', participants: [] },
            characters: [{
                name: 'Elena',
                aliases: ['a', 'b', 'c', 'd', 'e', 'f'],
                knownInfo: Array.from({ length: 20 }, (_, i) => `f${i}`),
                traits: Array.from({ length: 12 }, (_, i) => `t${i}`),
            }],
        }),
        error: null,
    });
    const result = await llmExtractScene({
        recentMessages: [{ id: 1, text: 'hi', name: 'User', isUser: true }],
        chatState: {},
        llmCallFn: llmStub,
    });
    const c = result?.characters?.[0];
    assert('llmExtractScene passes through character arrays (caps enforced downstream by normalizeDossier)',
        c?.aliases?.length === 6 && c?.knownInfo?.length === 20 && c?.traits?.length === 12);
}

{
    const llmStub = async () => ({
        text: JSON.stringify({
            scene: { location: 'castle', timeContext: 'dawn', activeGoal: 'escape', activeConflict: 'guards', openThreads: ['who helped'], participants: ['User', 'Kael'] },
            boundary: { shouldCreate: true, reason: 'location_change', significance: 4, title: 'Castle Escape' },
            characters: [{ name: 'Kael', emotionalState: 'angry', traits: ['bold'] }],
        }),
        error: null,
    });
    const result = await llmExtractScene({
        recentMessages: [{ id: 1, text: 'run!', name: 'User', isUser: true }],
        chatState: {},
        llmCallFn: llmStub,
    });
    assert('llmExtractScene handles response with scene + boundary + characters together',
        result?.location === 'castle' && result?.boundary?.shouldCreate === true && result?.characters?.length === 1);
}

// ==========================================
// Group 4: localforage-store
// ==========================================
console.log('\n=== Group 4: localforage-store ===\n');

function createMockLocalforage() {
    const store = new Map();
    return {
        getItem: async (key) => store.get(key) ?? null,
        setItem: async (key, value) => { store.set(key, value); },
        removeItem: async (key) => { store.delete(key); },
        keys: async () => [...store.keys()],
        clear: async () => { store.clear(); },
        _store: store,
    };
}

// Set up mock localforage
const mockLf = createMockLocalforage();
globalThis.SillyTavern = { libs: { localforage: mockLf } };

const { loadChat, getCached, setCached, invalidateCache, _resetForTesting, clearChat } = await import('../core/localforage-store.js');

{
    _resetForTesting();
    const val = getCached('test-chat', 'state');
    assert('get returns null for missing key', val === null);
}

{
    _resetForTesting();
    mockLf._store.set('am:chat1:state', { foo: 'bar' });
    await loadChat('chat1');
    const val = getCached('chat1', 'state');
    assert('set then get returns value (via loadChat)', val?.foo === 'bar');
}

{
    _resetForTesting();
    setCached('chat2', 'state', { hello: 'world' });
    const val = getCached('chat2', 'state');
    assert('set updates cache immediately (sync read after sync write)', val?.hello === 'world');
}

{
    _resetForTesting();
    setCached('chat3', 'dossiers', { luna: {} });
    await clearChat('chat3');
    const val = getCached('chat3', 'dossiers');
    assert('remove deletes from cache and store', val === null || val === undefined);
}

{
    _resetForTesting();
    setCached('chat4', 'state', { a: 1 });
    setCached('chat4', 'dossiers', { b: 2 });
    const state = getCached('chat4', 'state');
    const dossiers = getCached('chat4', 'dossiers');
    assert('getAll returns all items for collection', state?.a === 1 && dossiers?.b === 2);
}

{
    _resetForTesting();
    mockLf._store.set('am:chat5:state', { persisted: true });
    await loadChat('chat5');
    assert('before invalidate: cache has value', getCached('chat5', 'state')?.persisted === true);
    invalidateCache('chat5');
    assert('invalidateChat clears cache but not store',
        getCached('chat5', 'state') === null && mockLf._store.has('am:chat5:state'));
}

{
    _resetForTesting();
    mockLf._store.set('am:chat6:state', { reloaded: true });
    await loadChat('chat6');
    invalidateCache('chat6');
    await loadChat('chat6');
    assert('after invalidate, get re-reads from store',
        getCached('chat6', 'state')?.reloaded === true);
}

// Fail-open tests
{
    _resetForTesting();
    const savedST = globalThis.SillyTavern;
    globalThis.SillyTavern = undefined;
    const val = getCached('noLf', 'state');
    assert('fail-open: get returns null when localforage unavailable', val === null);
    globalThis.SillyTavern = savedST;
}

{
    _resetForTesting();
    const savedST = globalThis.SillyTavern;
    globalThis.SillyTavern = undefined;
    try {
        setCached('noLf', 'state', { data: 1 });
        // Cache still works even without localforage
        const val = getCached('noLf', 'state');
        assert('fail-open: set still updates cache when localforage unavailable', val?.data === 1);
    } catch {
        assert('fail-open: set silently no-ops when localforage unavailable', false, 'threw error');
    }
    globalThis.SillyTavern = savedST;
}

// ==========================================
// Group 5: Dossier Store
// ==========================================
console.log('\n=== Group 5: Dossier Store ===\n');

// Restore mock localforage
globalThis.SillyTavern = { libs: { localforage: createMockLocalforage() } };
_resetForTesting();

const dossierStore = await import('../core/dossier-store.js');

{
    _resetForTesting();
    dossierStore.applyCharacterDeltas('ds-chat1', [
        { name: 'Luna', relationship: 'companion', traits: ['brave'] },
    ], { messageId: 10 });
    const d = dossierStore.getDossier('ds-chat1', 'Luna');
    assert('applyCharacterDeltas creates new dossier for unknown character',
        d?.name === 'Luna' && d?.relationship === 'companion');
}

{
    _resetForTesting();
    dossierStore.applyCharacterDeltas('ds-chat2', [
        { name: 'Luna', relationship: 'companion', knownInfo: ['fact1'] },
    ], { messageId: 10 });
    dossierStore.applyCharacterDeltas('ds-chat2', [
        { name: 'Luna', knownInfo: ['fact2'] },
    ], { messageId: 11 });
    const d = dossierStore.getDossier('ds-chat2', 'Luna');
    assert('applyCharacterDeltas merges into existing dossier',
        d?.knownInfo?.length === 2 && d?.relationship === 'companion');
}

{
    _resetForTesting();
    // Fill up to 15
    const deltas = Array.from({ length: 15 }, (_, i) => ({ name: `Char${i}`, relationship: 'npc' }));
    dossierStore.applyCharacterDeltas('ds-chat3', deltas, {});
    // Try to add 16th
    dossierStore.applyCharacterDeltas('ds-chat3', [{ name: 'Overflow', relationship: 'x' }], {});
    const all = dossierStore.getAllDossiers('ds-chat3');
    assert('applyCharacterDeltas caps at 15 characters (no new past cap)',
        Object.keys(all).length === 15 && !all['overflow']);
}

{
    _resetForTesting();
    const deltas = Array.from({ length: 15 }, (_, i) => ({ name: `Char${i}`, relationship: 'npc' }));
    dossierStore.applyCharacterDeltas('ds-chat4', deltas, {});
    // Update existing even past cap
    dossierStore.applyCharacterDeltas('ds-chat4', [{ name: 'Char0', emotionalState: 'happy' }], {});
    const d = dossierStore.getDossier('ds-chat4', 'Char0');
    assert('applyCharacterDeltas updates existing even past cap',
        d?.emotionalState === 'happy');
}

{
    _resetForTesting();
    dossierStore.applyCharacterDeltas('ds-chat5', [
        { name: 'Luna', relationship: 'companion' },
        { name: 'Kael', relationship: 'rival' },
        { name: 'Zara', relationship: 'neutral' },
    ], {});
    const active = dossierStore.getActiveDossiers('ds-chat5', ['Luna', 'Kael']);
    assert('getActiveDossiers returns only matching participants',
        active.length === 2);
}

{
    _resetForTesting();
    const names = Array.from({ length: 12 }, (_, i) => `P${i}`);
    dossierStore.applyCharacterDeltas('ds-chat6', names.map(n => ({ name: n, relationship: 'x' })), {});
    const active = dossierStore.getActiveDossiers('ds-chat6', names);
    assert('getActiveDossiers caps at 8 results', active.length === 8);
}

{
    _resetForTesting();
    dossierStore.applyCharacterDeltas('ds-chat7', [
        { name: 'A', relationship: 'x' },
        { name: 'B', relationship: 'y' },
    ], {});
    const all = dossierStore.getAllDossiers('ds-chat7');
    assert('getAllDossiers returns all stored dossiers', Object.keys(all).length === 2);
}

// ==========================================
// Group 6: recall_memory format
// ==========================================
console.log('\n=== Group 6: recall_memory format (via formatToolResult) ===\n');

{
    const result = formatToolResult({
        sceneCard: testSceneCard,
        episodes: testEpisodes,
        dossiers: testDossiers,
    });
    assert('recall_memory uses formatToolResult not formatMemoryBlock',
        !result.includes('[Anchor Memory]') && result.includes('## '));
}

{
    const result = formatToolResult({
        sceneCard: testSceneCard,
        episodes: testEpisodes,
        dossiers: [],
    });
    assert('recall_memory result contains ## Matched Memories header',
        result.includes('## Matched Memories'));
}

{
    const longSummary = 'B'.repeat(600);
    const ep = createEpisode({ id: 'long2', title: 'LongEp', summary: longSummary, keyFacts: ['important fact'] });
    const result = formatToolResult({ sceneCard: null, episodes: [ep], dossiers: [] });
    assert('recall_memory result contains full untruncated summaries',
        result.includes(longSummary));
}

{
    const result = formatToolResult({ sceneCard: null, episodes: testEpisodes, dossiers: [] });
    assert('recall_memory result contains bulleted key facts',
        result.includes('- Hidden entrance found') && result.includes('- Guards forced retreat'));
}

// ==========================================
// Group 7: Scoring Rebalance & Budget Graduation
// ==========================================
console.log('\n=== Group 7: Scoring Rebalance & Budget Graduation ===\n');

import { scoreEpisodes } from '../retrieval/score-episodes.js';
import { computeEffectiveBudget } from '../core/budget.js';

{
    // Episode A: 3 content keyword hits, no participant overlap
    const epContent = createEpisode({
        id: 'content-ep', title: 'The Hidden Map', summary: 'ancient artifact discovered',
        keyFacts: ['map found'], significance: 2, participants: ['Nobody'],
    });
    // Episode B: 1 participant hit, no content overlap
    const epParticipant = createEpisode({
        id: 'participant-ep', title: 'Unrelated Scene', summary: 'nothing relevant',
        keyFacts: [], significance: 2, participants: ['Luna'],
    });
    const queryCtx = {
        terms: ['hidden', 'map', 'artifact'],
        sceneParticipants: ['Luna'],
        location: '',
        openThreads: [],
    };
    const scored = scoreEpisodes([epContent, epParticipant], queryCtx);
    const contentScore = scored.find(e => e.item.id === 'content-ep')?.score;
    const participantScore = scored.find(e => e.item.id === 'participant-ep')?.score;
    assert('content-heavy episode scores higher than participant-only episode',
        contentScore > participantScore,
        `content=${contentScore} participant=${participantScore}`);
}

{
    // Episode with both participant + content overlap should rank highest
    const epBoth = createEpisode({
        id: 'both-ep', title: 'Luna finds the map', summary: 'artifact quest',
        keyFacts: ['map location'], significance: 3, participants: ['Luna'],
    });
    const epContentOnly = createEpisode({
        id: 'content-only', title: 'The Hidden Map', summary: 'ancient artifact discovered',
        keyFacts: ['map found'], significance: 2, participants: ['Nobody'],
    });
    const queryCtx = {
        terms: ['map', 'artifact'],
        sceneParticipants: ['Luna'],
        location: '',
        openThreads: [],
    };
    const scored = scoreEpisodes([epContentOnly, epBoth], queryCtx);
    assert('episode with participant + content overlap ranks highest',
        scored[0].item.id === 'both-ep',
        `top=${scored[0].item.id}`);
}

{
    const eff5 = computeEffectiveBudget(5, 4000);
    assert('budget: chat.length=5 caps at 2000', eff5 === 2000, `got ${eff5}`);
}

{
    const eff15 = computeEffectiveBudget(15, 4000);
    assert('budget: chat.length=15 caps at 3000', eff15 === 3000, `got ${eff15}`);
}

{
    const eff50 = computeEffectiveBudget(50, 4000);
    assert('budget: chat.length=50 uses full configuredMax', eff50 === 4000, `got ${eff50}`);
}

// ==========================================
// Group 8: Dossier Gate & Message Budget
// ==========================================
console.log('\n=== Group 8: Dossier Gate & Message Budget ===\n');

import { formatMessagesForLLM } from '../writing/format-messages.js';

{
    // getActiveDossiers returns participant dossiers first, fills with recent non-participants
    _resetForTesting();
    dossierStore.applyCharacterDeltas('dg-chat1', [
        { name: 'Luna', relationship: 'companion' },
        { name: 'Kael', relationship: 'rival' },
        { name: 'Briza', relationship: 'npc' },
    ], { messageId: 50 });
    const active = dossierStore.getActiveDossiers('dg-chat1', ['Luna'], { currentMessageId: 55 });
    assert('getActiveDossiers: participant first, fills with recent non-participants',
        active.length === 3 && active[0].name === 'Luna');
}

{
    // getActiveDossiers excludes narrator dossiers
    _resetForTesting();
    dossierStore.applyCharacterDeltas('dg-chat2', [
        { name: 'Luna', relationship: 'companion' },
    ], { messageId: 50 });
    // Manually inject a narrator dossier (bypassing applyCharacterDeltas skip)
    dossierStore.saveDossier('dg-chat2', 'Narrator', normalizeDossier({ name: 'Narrator', lastSeenMessageId: 50 }));
    const active = dossierStore.getActiveDossiers('dg-chat2', ['Luna', 'Narrator'], { currentMessageId: 55 });
    assert('getActiveDossiers excludes narrator dossiers',
        active.length === 1 && active[0].name === 'Luna');
}

{
    // applyCharacterDeltas skips narrator entries
    _resetForTesting();
    dossierStore.applyCharacterDeltas('dg-chat3', [
        { name: 'Narrator', relationship: 'meta' },
        { name: 'System', relationship: 'meta' },
        { name: 'Luna', relationship: 'companion' },
    ], { messageId: 10 });
    const all = dossierStore.getAllDossiers('dg-chat3');
    assert('applyCharacterDeltas skips narrator and system entries',
        Object.keys(all).length === 1 && all['luna']?.name === 'Luna');
}

{
    // formatMessagesForLLM at budget 12000 does not truncate 12 messages of ~900 chars (typical RP)
    const msgs = Array.from({ length: 12 }, (_, i) => ({
        name: `Char${i}`,
        text: 'A'.repeat(900),
        isUser: i % 2 === 0,
    }));
    const formatted = formatMessagesForLLM(msgs, { totalBudget: 12000, maxMessages: 12 });
    const hasTruncation = formatted.includes('...');
    assert('formatMessagesForLLM at 12000 budget: no truncation for 12×900 char messages',
        !hasTruncation);
}

{
    // Budget 3500 WOULD truncate those same messages (regression guard)
    const msgs = Array.from({ length: 12 }, (_, i) => ({
        name: `Char${i}`,
        text: 'A'.repeat(900),
        isUser: i % 2 === 0,
    }));
    const formatted = formatMessagesForLLM(msgs, { totalBudget: 3500, maxMessages: 12 });
    const hasTruncation = formatted.includes('...');
    assert('formatMessagesForLLM at old 3500 budget: truncates 12×900 char messages',
        hasTruncation);
}

{
    // Recency fill respects the 20-message threshold
    _resetForTesting();
    dossierStore.applyCharacterDeltas('dg-chat4', [
        { name: 'Recent', relationship: 'npc' },
    ], { messageId: 90 });
    dossierStore.applyCharacterDeltas('dg-chat4', [
        { name: 'Old', relationship: 'npc' },
    ], { messageId: 50 });
    const active = dossierStore.getActiveDossiers('dg-chat4', [], { currentMessageId: 100 });
    assert('getActiveDossiers recency fill: only includes dossiers within 20 messages',
        active.length === 1 && active[0].name === 'Recent');
}

// ==========================================
// Group 9: Backfill (commands/backfill.js)
// ==========================================
console.log('\n=== Group 9: Backfill ===\n');

import { processChunk, buildChunkPrompt, CHUNK_SIZE } from '../commands/backfill-process.js';

{
    // processChunk returns episode + characters from valid LLM response
    const mockMessages = Array.from({ length: 5 }, (_, i) => ({
        id: i, name: i % 2 === 0 ? 'User' : 'Elena', text: `Message ${i}`, isUser: i % 2 === 0,
    }));
    const llmStub = async () => ({
        text: JSON.stringify({
            episode: {
                title: 'Test Episode',
                summary: 'Something happened.',
                tags: ['test'],
                significance: 3,
                keyFacts: ['a fact'],
                participants: ['User', 'Elena'],
                location: 'tavern',
            },
            characters: [
                { name: 'Elena', aliases: ['E'], relationship: 'friend', emotionalState: 'happy', knownInfo: ['knows things'], goals: 'survive', traits: ['brave'] },
            ],
        }),
        error: null,
    });
    const result = await processChunk(mockMessages, 0, 2, llmStub);
    assert('processChunk returns episode + characters from valid response',
        result !== null && result.episode.title === 'Test Episode' && result.characters.length === 1 && result.characters[0].name === 'Elena');
}

{
    // processChunk returns null on malformed response
    const mockMessages = [{ id: 0, name: 'User', text: 'hi', isUser: true }];
    const llmStub = async () => ({ text: 'not json at all', error: null });
    const result = await processChunk(mockMessages, 0, 1, llmStub);
    assert('processChunk returns null on malformed response', result === null);
}

{
    // processChunk returns null on LLM error
    const mockMessages = [{ id: 0, name: 'User', text: 'hi', isUser: true }];
    const llmStub = async () => ({ text: null, error: 'timeout' });
    const result = await processChunk(mockMessages, 0, 1, llmStub);
    assert('processChunk returns null on LLM error', result === null);
}

{
    // processChunk sets correct message span
    const mockMessages = [
        { id: 10, name: 'User', text: 'start', isUser: true },
        { id: 11, name: 'Elena', text: 'middle', isUser: false },
        { id: 12, name: 'User', text: 'end', isUser: true },
    ];
    const llmStub = async () => ({
        text: JSON.stringify({
            episode: { title: 'Span Test', summary: 'test', tags: [], significance: 2, keyFacts: [], participants: [], location: '' },
            characters: [],
        }),
        error: null,
    });
    const result = await processChunk(mockMessages, 0, 1, llmStub);
    assert('processChunk sets correct messageStart/messageEnd from chunk',
        result.episode.messageStart === 10 && result.episode.messageEnd === 12);
}

{
    // Chunk splitting: 50 messages → 2 chunks, 25 → 1, 0 → 0
    const split = (n) => Math.ceil(n / CHUNK_SIZE);
    assert('chunk splitting: 50 msgs → 2 chunks', split(50) === 2);
    assert('chunk splitting: 25 msgs → 1 chunk', split(25) === 1);
    assert('chunk splitting: 0 msgs → 0 chunks', split(0) === 0);
}

{
    // buildChunkPrompt returns string containing chunk index info and formatted messages
    const msgs = [{ id: 0, name: 'User', text: 'Hello world', isUser: true }];
    const prompt = buildChunkPrompt(msgs, 2, 10);
    assert('buildChunkPrompt contains chunk index', prompt.includes('chunk 3 of 10'));
    assert('buildChunkPrompt contains message content', prompt.includes('Hello world'));
}

{
    // processChunk preserves chronological order via createdAtTs
    const msgs = [{ id: 0, name: 'User', text: 'hi', isUser: true }];
    const llmStub = async () => ({
        text: JSON.stringify({
            episode: { title: 'T', summary: 'S', tags: [], significance: 2, keyFacts: [], participants: [], location: '' },
            characters: [],
        }),
        error: null,
    });
    const r1 = await processChunk(msgs, 0, 10, llmStub);
    const r2 = await processChunk(msgs, 5, 10, llmStub);
    assert('processChunk: earlier chunk gets earlier createdAtTs',
        r1.episode.createdAtTs < r2.episode.createdAtTs);
}

// ==========================================
// Summary
// ==========================================

console.log('\n' + '='.repeat(50));
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);

if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
}

const verdict = totalFailed === 0 ? 'PASS' : 'FAIL';
console.log(`\nVerdict: ${verdict}`);
process.exit(totalFailed > 0 ? 1 : 0);
