import { extractStateUpdates } from '../writing/extract-state.js';
import { extractStateWindowed } from '../writing/windowed-extractor.js';
import { buildEpisodeCandidate } from '../writing/build-episode.js';
import { createEpisode } from '../models/episodes.js';
import { createSceneCard, mergeSceneCard } from '../models/state-cards.js';
import { buildQueryContext } from '../retrieval/query-builder.js';
import { scoreSceneCard } from '../retrieval/score-state.js';
import { scoreEpisodes } from '../retrieval/score-episodes.js';
import { selectMemoryItems } from '../retrieval/selector.js';
import { formatMemoryBlock } from '../retrieval/formatter.js';
import {
    CHAT_MESSAGES,
    CHECKPOINTS,
    EPISODE_EXPECTATIONS,
    RETRIEVAL_QUERIES,
    NOISE_TEST,
} from './fixture.js';

// --- Scoring helpers ---

function fieldMatch(extracted, expected) {
    if (!expected && !extracted) return true;
    if (!expected) return true;
    if (!extracted) return false;
    return String(extracted).toLowerCase().includes(String(expected).toLowerCase());
}

function participantsMatch(extracted, expected) {
    if (!expected || expected.length === 0) return true;
    const extractedLower = (extracted || []).map(p => p.toLowerCase());
    return expected.every(p => extractedLower.some(e => e.includes(p.toLowerCase())));
}

function threadsMatch(extracted, expected) {
    if (!expected || expected.length === 0) return true;
    const joined = (extracted || []).join(' ').toLowerCase();
    return expected.every(t => joined.includes(t.toLowerCase()));
}

// --- Test runner ---

let totalPassed = 0;
let totalFailed = 0;
const failures = [];

function assert(testGroup, name, condition, detail = '') {
    if (condition) {
        totalPassed++;
    } else {
        totalFailed++;
        failures.push(`[${testGroup}] ${name}${detail ? ': ' + detail : ''}`);
    }
    const icon = condition ? '  PASS' : '  FAIL';
    console.log(`${icon}  ${name}${detail && !condition ? ' — ' + detail : ''}`);
}

function msgsUpTo(id) {
    return CHAT_MESSAGES.filter(m => m.id <= id);
}

// --- Test 1: Flat extraction accuracy ---

console.log('\n=== Test 1: Flat Extraction ===');

for (const cp of CHECKPOINTS) {
    console.log(`\n  Checkpoint: ${cp.label} (after msg ${cp.afterMessageId})`);
    const messages = msgsUpTo(cp.afterMessageId);
    const result = extractStateUpdates({ recentMessages: messages });

    assert('extraction', `${cp.label} — location`, fieldMatch(result.location, cp.expected.location),
        `got "${result.location}", want "${cp.expected.location}"`);

    if (cp.expected.timeContext) {
        assert('extraction', `${cp.label} — timeContext`, fieldMatch(result.timeContext, cp.expected.timeContext),
            `got "${result.timeContext}", want "${cp.expected.timeContext}"`);
    }
    if (cp.expected.activeGoal) {
        assert('extraction', `${cp.label} — activeGoal`, fieldMatch(result.activeGoal, cp.expected.activeGoal),
            `got "${result.activeGoal}", want "${cp.expected.activeGoal}"`);
    }
    if (cp.expected.activeConflict) {
        assert('extraction', `${cp.label} — activeConflict`, fieldMatch(result.activeConflict, cp.expected.activeConflict),
            `got "${result.activeConflict}", want "${cp.expected.activeConflict}"`);
    }
    assert('extraction', `${cp.label} — participants`, participantsMatch(result.participants, cp.expected.participants),
        `got [${result.participants}], want [${cp.expected.participants}]`);

    if (cp.expected.openThreads.length > 0) {
        assert('extraction', `${cp.label} — openThreads`, threadsMatch(result.openThreads, cp.expected.openThreads),
            `got [${result.openThreads.join('; ')}], want [${cp.expected.openThreads}]`);
    }
}

// --- Test 2: Windowed extraction ---

console.log('\n=== Test 2: Windowed Extraction ===');

for (const cp of CHECKPOINTS) {
    console.log(`\n  Checkpoint: ${cp.label} (after msg ${cp.afterMessageId})`);
    const messages = msgsUpTo(cp.afterMessageId);
    const result = extractStateWindowed({ recentMessages: messages, windowSize: 8, overlap: 3 });

    assert('windowed', `${cp.label} — location`, fieldMatch(result.location, cp.expected.location),
        `got "${result.location}", want "${cp.expected.location}"`);

    if (cp.expected.timeContext) {
        assert('windowed', `${cp.label} — timeContext`, fieldMatch(result.timeContext, cp.expected.timeContext),
            `got "${result.timeContext}", want "${cp.expected.timeContext}"`);
    }
    if (cp.expected.activeGoal) {
        assert('windowed', `${cp.label} — activeGoal`, fieldMatch(result.activeGoal, cp.expected.activeGoal),
            `got "${result.activeGoal}", want "${cp.expected.activeGoal}"`);
    }
    assert('windowed', `${cp.label} — participants`, participantsMatch(result.participants, cp.expected.participants),
        `got [${result.participants}], want [${cp.expected.participants}]`);
}

// Windowed should correctly identify location at checkpoint 3
const noiseCp = CHECKPOINTS[NOISE_TEST.checkpointIndex];
const noiseMessages = msgsUpTo(noiseCp.afterMessageId);
const noiseResult = extractStateWindowed({ recentMessages: noiseMessages, windowSize: 8, overlap: 3 });
assert('windowed', 'Windowed location accuracy at tunnels checkpoint',
    fieldMatch(noiseResult.location, NOISE_TEST.correctLocation),
    `got "${noiseResult.location}", want "${NOISE_TEST.correctLocation}"`);

// --- Test 3: Episode creation ---

console.log('\n=== Test 3: Episode Creation ===');

for (const ep of EPISODE_EXPECTATIONS) {
    const messages = msgsUpTo(ep.triggerAfterMessageId);
    const chatState = {
        sceneCard: createSceneCard(),
        episodes: [],
        lastEpisodeBoundaryMessageId: -1,
    };
    const candidate = await buildEpisodeCandidate({
        chatState,
        recentMessages: messages,
        settings: { sceneMessageThreshold: ep.threshold },
        force: ep.force || false,
    });

    assert('episodes', `${ep.label} — created`, ep.expect.created ? candidate !== null : candidate === null,
        candidate ? `title="${candidate.title}"` : 'null');

    if (candidate && ep.expect.minSignificance) {
        assert('episodes', `${ep.label} — significance >= ${ep.expect.minSignificance}`,
            candidate.significance >= ep.expect.minSignificance,
            `got ${candidate.significance}`);
    }
}

// --- Test 4: Retrieval ranking ---

console.log('\n=== Test 4: Retrieval Ranking ===');

// Build episodes from different scenes
const tavernEpisode = createEpisode({
    id: 'ep_tavern', messageStart: 0, messageEnd: 9,
    title: 'Scene at The Rusty Anchor', summary: 'Arrived at The Rusty Anchor tavern. Met Elena who told us about the missing map.',
    participants: ['User', 'Elena'], locations: ['The Rusty Anchor'],
    tags: ['location', 'goal'], significance: 2,
});
const cellarEpisode = createEpisode({
    id: 'ep_cellar', messageStart: 10, messageEnd: 19,
    title: 'Scene in the cellar', summary: 'Descended to the cellar. Fought giant rats. Discovered hidden door with ancient runes.',
    participants: ['User', 'Elena'], locations: ['the cellar'],
    tags: ['conflict', 'location', 'mystery'], significance: 3,
});
const betrayalEpisode = createEpisode({
    id: 'ep_betrayal', messageStart: 20, messageEnd: 29,
    title: 'Betrayal in the tunnels', summary: 'Elena betrayed us in the underground tunnels. She attacked with a hidden dagger. Mentioned "The Order".',
    participants: ['User', 'Elena'], locations: ['underground tunnels'],
    tags: ['relationship', 'conflict'], significance: 5,
});

const allEpisodes = [tavernEpisode, cellarEpisode, betrayalEpisode];

for (const rq of RETRIEVAL_QUERIES) {
    const queryContext = buildQueryContext({
        recentMessages: [{ text: rq.queryText }],
        sceneCard: null,
    });
    const scored = scoreEpisodes(allEpisodes, queryContext);
    const top = scored[0];

    assert('retrieval', `${rq.label} — top result`,
        top && (top.item.title + ' ' + top.item.summary).toLowerCase().includes(rq.expectedTopContains.toLowerCase()),
        `top="${top?.item?.title}", want contains "${rq.expectedTopContains}"`);
}

// --- Test 5: End-to-end pipeline ---

console.log('\n=== Test 5: End-to-End Pipeline ===');

// Build state incrementally
let sceneCard = createSceneCard();
const episodes = [];
let lastBoundary = -1;

for (let i = 0; i < CHAT_MESSAGES.length; i += 10) {
    const batch = CHAT_MESSAGES.slice(0, i + 10);
    const stateUpdate = extractStateUpdates({ recentMessages: batch });
    sceneCard = mergeSceneCard(sceneCard, stateUpdate, { updatedAtMessageId: i + 9, updatedAtTs: Date.now() });

    const candidate = await buildEpisodeCandidate({
        chatState: { sceneCard, episodes, lastEpisodeBoundaryMessageId: lastBoundary },
        recentMessages: batch,
        settings: { sceneMessageThreshold: 10 },
    });
    if (candidate) {
        episodes.push(candidate);
        lastBoundary = candidate.messageEnd;
    }
}

assert('e2e', 'Episodes created during simulation', episodes.length >= 1,
    `got ${episodes.length} episodes`);

// Run retrieval at the end
const finalMessages = CHAT_MESSAGES.slice(-3);
const queryContext = buildQueryContext({ recentMessages: finalMessages, sceneCard });
const scoredScene = scoreSceneCard(sceneCard, queryContext);
const scoredEps = scoreEpisodes(episodes, queryContext);
const selected = selectMemoryItems({ scoredSceneCard: scoredScene, scoredEpisodes: scoredEps, settings: { maxEpisodesInjected: 3 } });
const memoryBlock = formatMemoryBlock({ sceneCard: selected.sceneCard, episodes: selected.episodes, maxChars: 4000 });

assert('e2e', 'Memory block is non-empty', memoryBlock.length > 0);
assert('e2e', 'Memory block under 4000 chars', memoryBlock.length <= 4000,
    `got ${memoryBlock.length} chars`);
assert('e2e', 'Memory block contains current location',
    memoryBlock.toLowerCase().includes('forest') || memoryBlock.toLowerCase().includes('citadel'),
    `block does not reference current scene`);

// --- Test 6: XML format ---

console.log('\n=== Test 6: XML Format ===');

const xmlBlock = formatMemoryBlock({ sceneCard: selected.sceneCard, episodes: selected.episodes, maxChars: 4000, format: 'xml' });
assert('xml', 'XML block is non-empty', xmlBlock.length > 0);
assert('xml', 'XML block starts with <anchor_memory>', xmlBlock.startsWith('<anchor_memory>'));
assert('xml', 'XML block ends with </anchor_memory>', xmlBlock.trimEnd().endsWith('</anchor_memory>'));
assert('xml', 'XML block contains <scene>', xmlBlock.includes('<scene>'));
assert('xml', 'XML block under 4000 chars', xmlBlock.length <= 4000, `got ${xmlBlock.length} chars`);
assert('xml', 'XML block contains location', xmlBlock.toLowerCase().includes('forest') || xmlBlock.toLowerCase().includes('citadel'));

// Empty input returns empty for both formats
const emptyText = formatMemoryBlock({ sceneCard: null, episodes: [], format: 'text' });
const emptyXml = formatMemoryBlock({ sceneCard: null, episodes: [], format: 'xml' });
assert('xml', 'Empty text returns empty string', emptyText === '');
assert('xml', 'Empty xml returns empty string', emptyXml === '');

// --- Results ---

console.log('\n' + '='.repeat(50));
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);

if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
}

const verdict = totalFailed === 0 ? 'PASS' : 'FAIL';
console.log(`\nVerdict: ${verdict}`);
process.exit(totalFailed > 0 ? 1 : 0);
