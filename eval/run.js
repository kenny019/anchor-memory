import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isMemoryConfigured, getMemoryInactiveReason } from '../core/memory-config.js';
import {
    normalizeChatMessages,
    resolveStoredMessageId,
    resolveStoredSpan,
    getMessagesForStoredEpisode,
    buildTurnKey,
    buildLegacyTurnKey,
} from '../core/messages.js';
import { createEpisode, pruneArchivedEpisodes } from '../models/episodes.js';
import { clusterEpisodesAtDepth } from '../writing/consolidate-episodes.js';
import { prepareGenerationMemoryData } from '../runtime/prepare-memory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

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

console.log('\n=== Test 1: Memory Configuration ===\n');

assert('Unconfigured settings disable memory', !isMemoryConfigured({ memoryModelSource: '', memoryModel: '' }));
assert(
    'Unconfigured settings expose clear reason',
    getMemoryInactiveReason({ memoryModelSource: '', memoryModel: '' }).toLowerCase().includes('configure'),
);
assert(
    'Configured settings enable memory',
    isMemoryConfigured({ memoryModelSource: 'openrouter', memoryModel: 'openai/gpt-5.4-nano' }),
);

console.log('\n=== Test 2: Message Normalization and Legacy Span Compatibility ===\n');

const rawMessages = [
    { messageId: 100, is_user: true, name: 'User', mes: 'We enter the cellar.' },
    { messageId: 101, is_user: false, name: 'Elena', mes: 'I do not trust this place.' },
    { messageId: 102, is_user: true, name: 'User', mes: 'Elena betrayed me with a dagger.' },
    { messageId: 103, is_user: false, name: 'Elena', mes: 'The Order sent me.' },
];
const normalized = normalizeChatMessages(rawMessages, { name1: 'User', name2: 'Elena' });

assert('Canonical IDs come from messageId', normalized[0].id === 100 && normalized[3].id === 103);
assert('Legacy indices are preserved', normalized[2].legacyIndex === 2);
assert('Legacy stored boundary resolves to canonical ID', resolveStoredMessageId(2, normalized) === 102);

const legacyEpisode = { messageStart: 2, messageEnd: 3 };
const canonicalSpan = resolveStoredSpan(legacyEpisode, normalized);
assert('Legacy span resolves to canonical IDs', canonicalSpan?.start === 102 && canonicalSpan?.end === 103);
assert(
    'Legacy span maps to the correct messages',
    getMessagesForStoredEpisode(normalized, legacyEpisode).map(message => message.id).join(',') === '102,103',
);
assert('Canonical and legacy turn keys differ when IDs differ from indices', buildTurnKey(normalized[3]) !== buildLegacyTurnKey(normalized[3]));

console.log('\n=== Test 3: Consolidation Cluster Regression ===\n');

const bridgeEpisodes = [
    createEpisode({ id: 'a', participants: ['p1'] }),
    createEpisode({ id: 'b', participants: ['p1', 'p2'] }),
    createEpisode({ id: 'c', participants: ['p2'] }),
    createEpisode({ id: 'd', participants: ['p2'] }),
    createEpisode({ id: 'e', participants: ['p2'] }),
];
const bridgeClusters = clusterEpisodesAtDepth(bridgeEpisodes, 0, { fanout: 4, jaccardThreshold: 0.5 });

assert('Bridge cluster is no longer lost', bridgeClusters.length >= 1, `got ${bridgeClusters.length}`);
assert(
    'Bridge cluster still contains the valid connected set',
    bridgeClusters.some(cluster => ['b', 'c', 'd', 'e'].every(id => cluster.some(episode => episode.id === id))),
);

console.log('\n=== Test 4: Archived Pruning ===\n');

const archivedEpisodes = [
    createEpisode({ id: 'old_a', archived: true, createdAtTs: 1 }),
    createEpisode({ id: 'old_b', archived: true, createdAtTs: 2 }),
    createEpisode({ id: 'old_c', archived: true, createdAtTs: 3 }),
    createEpisode({ id: 'semantic', archived: false, sourceEpisodeIds: ['old_c'] }),
];
const pruned = pruneArchivedEpisodes(archivedEpisodes, 2);
assert('Archived pruning removes oldest unprotected episode', !pruned.some(episode => episode.id === 'old_a'));
assert('Archived pruning keeps lineage-protected episode', pruned.some(episode => episode.id === 'old_c'));

console.log('\n=== Test 5: Retrieval Preparation ===\n');

const tavernEpisode = createEpisode({
    id: 'ep_tavern',
    messageStart: 100,
    messageEnd: 101,
    title: 'Tavern warning',
    summary: 'Met Elena in the tavern and heard about the missing map.',
    participants: ['User', 'Elena'],
    locations: ['tavern'],
    significance: 2,
});
const betrayalEpisode = createEpisode({
    id: 'ep_betrayal',
    messageStart: 2,
    messageEnd: 3,
    title: 'Elena betrayal',
    summary: 'Elena betrayed the user with a dagger and named The Order.',
    participants: ['User', 'Elena'],
    locations: ['cellar'],
    significance: 5,
});

const llmStub = async ({ prompt }) => {
    if (prompt.includes('Return JSON array')) {
        return { text: '[{"n": 1, "s": 10}]', error: null };
    }
    if (prompt.includes('How relevant is this conversation')) {
        if (prompt.includes('betrayed the user with a dagger')) {
            return { text: '{"s": 10, "reason": "dagger betrayal"}', error: null };
        }
        return { text: '{"s": 2, "reason": "weak match"}', error: null };
    }
    return { text: '[]', error: null };
};

const prepared = await prepareGenerationMemoryData({
    chatState: {
        sceneCard: {
            location: 'cellar',
            timeContext: '',
            activeGoal: 'stop The Order',
            activeConflict: 'Elena betrayed the user',
            participants: ['User', 'Elena'],
            openThreads: ['Who sent Elena'],
        },
        episodes: [tavernEpisode, betrayalEpisode],
    },
    recentMessages: [{ text: 'Elena betrayed me with a dagger. The Order is behind this.' }],
    allMessages: normalized,
    settings: { maxEpisodesInjected: 2, retrievalCandidateCount: 4, retrievalChunkSize: 4, memoryFormat: 'text' },
    llmCallFn: llmStub,
});

assert('Retrieval preparation returns a non-empty memory block', prepared.memoryBlock.length > 0);
assert('Retrieval preparation selects betrayal episode first', prepared.selected.episodes[0]?.id === 'ep_betrayal');

console.log('\n=== Test 6: User-Facing Copy Cleanup ===\n');

const bannedPatterns = [
    /\bfree mode\b/i,
    /\bfree tier\b/i,
    /\bheuristic mode\b/i,
];
const copyFiles = [
    join(repoRoot, 'README.md'),
    join(repoRoot, 'settings.html'),
    join(repoRoot, 'docs', 'BUILD_PLAN.md'),
];

for (const filePath of copyFiles) {
    const content = readFileSync(filePath, 'utf-8');
    for (const pattern of bannedPatterns) {
        assert(
            `${filePath.replace(repoRoot + '/', '')} excludes ${pattern}`,
            !pattern.test(content),
        );
    }
}

console.log('\n' + '='.repeat(50));
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);

if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
}

const verdict = totalFailed === 0 ? 'PASS' : 'FAIL';
console.log(`\nVerdict: ${verdict}`);
process.exit(totalFailed > 0 ? 1 : 0);
