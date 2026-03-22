import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createEpisode } from '../models/episodes.js';
import { buildQueryContext } from '../retrieval/query-builder.js';
import { scoreEpisodes } from '../retrieval/score-episodes.js';
import { clusterEpisodes, consolidateEpisodes, buildConsolidationPrompt } from '../writing/consolidate-episodes.js';
import { rerankEpisodes } from '../retrieval/reranker.js';
import { rlmRetrieve } from '../retrieval/rlm-retriever.js';

// --- Env loading ---

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function loadEnv() {
    if (process.env.OPENROUTER_API_KEY) return;
    try {
        const envPath = join(repoRoot, '.env');
        const content = readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx < 0) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            if (!process.env[key]) process.env[key] = val;
        }
    } catch {
        // .env file doesn't exist, rely on process.env
    }
}

loadEnv();

if (!process.env.OPENROUTER_API_KEY) {
    console.error('ERROR: OPENROUTER_API_KEY not set.');
    console.error('');
    console.error('Set it via:');
    console.error('  export OPENROUTER_API_KEY=sk-or-...');
    console.error('  or create a .env file (see .env.example)');
    process.exit(1);
}

// --- OpenRouter caller ---

async function openRouterCall({ prompt, systemPrompt, maxTokens }) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'openai/gpt-5.4-nano',
            messages: [
                ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                { role: 'user', content: prompt },
            ],
            max_tokens: maxTokens || 300,
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return { text: null, error: err.error?.message || `HTTP ${response.status}: ${response.statusText}` };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || null;
    const tokens = data.usage?.total_tokens || 0;
    if (tokens > 0) console.log(`    (${tokens} tokens used)`);
    return { text, error: null };
}

// --- Test runner ---

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function assert(group, name, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  PASS  ${name}`);
    } else {
        failed++;
        failures.push(`[${group}] ${name}${detail ? ': ' + detail : ''}`);
        console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    }
}

function skip(group, name, reason) {
    skipped++;
    console.log(`  SKIP  ${name} — ${reason}`);
}

// --- Test episodes ---

const tavernEpisode = createEpisode({
    id: 'ep_tavern', messageStart: 0, messageEnd: 9,
    title: 'Scene at The Rusty Anchor', summary: 'Arrived at The Rusty Anchor tavern and met Elena. She told us about a missing map stolen from the archives.',
    participants: ['User', 'Elena'], locations: ['The Rusty Anchor'],
    tags: ['location', 'goal'], significance: 2,
});

const cellarEpisode = createEpisode({
    id: 'ep_cellar', messageStart: 10, messageEnd: 19,
    title: 'Scene in the cellar', summary: 'Descended to the cellar beneath the tavern. Fought giant rats and discovered a hidden stone door with ancient runes.',
    participants: ['User', 'Elena'], locations: ['the cellar'],
    tags: ['conflict', 'location', 'mystery'], significance: 3,
});

const tunnelEpisode = createEpisode({
    id: 'ep_tunnels', messageStart: 20, messageEnd: 24,
    title: 'Scene in the underground tunnels', summary: 'Entered the underground tunnels through the hidden door. Found glowing crystals on the walls. Night fell.',
    participants: ['User', 'Elena'], locations: ['underground tunnels'],
    tags: ['location', 'mystery'], significance: 2,
});

const betrayalEpisode = createEpisode({
    id: 'ep_betrayal', messageStart: 25, messageEnd: 29,
    title: 'Elena betrayal in the tunnels', summary: 'Elena betrayed us with a hidden dagger in the underground tunnels. She mentioned "The Order" before fleeing into the darkness.',
    participants: ['User', 'Elena'], locations: ['underground tunnels'],
    tags: ['relationship', 'conflict'], significance: 5,
});

const forestEpisode = createEpisode({
    id: 'ep_forest', messageStart: 30, messageEnd: 34,
    title: 'Escape to the forest', summary: 'Escaped from the tunnels into a moonlit forest. Wounded from Elena\'s dagger. The citadel is to the north.',
    participants: ['User'], locations: ['the forest'],
    tags: ['location', 'goal'], significance: 2,
});

const forestEpisode2 = createEpisode({
    id: 'ep_forest2', messageStart: 35, messageEnd: 39,
    title: 'Riders approach in the forest', summary: 'Heard hoofbeats from the east. Riders approaching. Must reach the citadel before being found.',
    participants: ['User'], locations: ['the forest'],
    tags: ['conflict', 'goal'], significance: 3,
});

const allEpisodes = [tavernEpisode, cellarEpisode, tunnelEpisode, betrayalEpisode, forestEpisode, forestEpisode2];

// --- Test 1: Consolidation ---

console.log('\n=== Test 1: Episode Consolidation (LLM) ===\n');

const clusters = clusterEpisodes(allEpisodes);
assert('consolidation', 'Clustering produces at least 1 cluster', clusters.length >= 1,
    `got ${clusters.length} clusters`);

if (clusters.length >= 1) {
    console.log(`  (${clusters.length} cluster(s), sizes: [${clusters.map(c => c.length).join(', ')}])`);

    const result = await consolidateEpisodes({ chatState: { episodes: allEpisodes }, llmCallFn: openRouterCall });

    if (result.archivedIds.length === 0 && clusters.length > 0) {
        // Check if LLM call failed
        skip('consolidation', 'LLM consolidation results', 'LLM returned no usable results — check API');
    } else {
        assert('consolidation', 'Has archived IDs', result.archivedIds.length > 0,
            `archived ${result.archivedIds.length}`);
        assert('consolidation', 'Has new semantic episodes', result.newEpisodes.length > 0,
            `created ${result.newEpisodes.length}`);

        for (const ep of result.newEpisodes) {
            assert('consolidation', `Semantic ep "${ep.title}" has title`, ep.title.length > 0);
            assert('consolidation', `Semantic ep "${ep.title}" has summary`, ep.summary.length > 0);
            assert('consolidation', `Semantic ep "${ep.title}" significance 1-5`,
                ep.significance >= 1 && ep.significance <= 5, `got ${ep.significance}`);
            assert('consolidation', `Semantic ep "${ep.title}" has source IDs`,
                ep.sourceEpisodeIds.length > 0, `got ${ep.sourceEpisodeIds.length}`);
            assert('consolidation', `Semantic ep "${ep.title}" type is semantic`,
                ep.type === 'semantic', `got "${ep.type}"`);
        }
    }
} else {
    skip('consolidation', 'LLM consolidation', 'No clusters formed — check episode overlap');
}

// --- Test 2: Re-ranking ---

console.log('\n=== Test 2: Episode Re-ranking (LLM) ===\n');

const rerankCandidates = [tavernEpisode, cellarEpisode, betrayalEpisode].map(ep => ({
    item: ep, score: 5, reasons: ['test'],
}));

const queryContext = buildQueryContext({
    recentMessages: [{ text: 'Elena betrayed me with a dagger. Who sent her? The Order must be stopped.' }],
    sceneCard: null,
});

const reranked = await rerankEpisodes({
    candidates: rerankCandidates,
    queryContext,
    llmCallFn: openRouterCall,
    timeoutMs: 15000,
});

if (reranked === rerankCandidates) {
    skip('reranking', 'Re-ranking results', 'LLM call failed, returned original order');
} else {
    assert('reranking', 'All candidates present in output',
        reranked.length === rerankCandidates.length,
        `got ${reranked.length}, want ${rerankCandidates.length}`);

    const topItem = reranked[0]?.item || reranked[0];
    assert('reranking', 'Betrayal episode ranks #1',
        topItem?.id === 'ep_betrayal',
        `top="${topItem?.title}" (${topItem?.id})`);

    console.log(`  Ranking: ${reranked.map((r, i) => `${i + 1}. ${(r.item || r).title}`).join(', ')}`);
}

// --- Test 3: Prompt visibility ---

console.log('\n=== Test 3: Prompt Visibility ===\n');

if (clusters.length > 0) {
    console.log('--- Consolidation Prompt (cluster 1) ---');
    console.log(buildConsolidationPrompt(clusters[0]));
    console.log('');
}

console.log('--- Re-rank Prompt ---');
// Rebuild prompt for visibility
const sceneParts = [];
if (queryContext.location) sceneParts.push(`Location: ${queryContext.location}`);
if (queryContext.sceneParticipants?.length) sceneParts.push(`Participants: ${queryContext.sceneParticipants.join(', ')}`);
const sceneCtx = sceneParts.length > 0 ? sceneParts.join('\n') : 'No current scene context';
const episodeList = rerankCandidates.map((ep, i) => {
    const item = ep.item || ep;
    return `${i + 1}. ${item.title} - ${(item.summary || '').slice(0, 150)}`;
}).join('\n');
console.log(`Current scene:\n${sceneCtx}\n\nRecent context:\n${(queryContext.recentText || '').slice(0, 500)}\n\nRank these memory episodes by relevance...\n\n${episodeList}`);

// --- Test 4: RLM Retrieval ---

console.log('\n=== Test 4: RLM Retrieval (LLM) ===\n');

const rlmQueryContext = buildQueryContext({
    recentMessages: [{ text: 'Elena betrayed me with a dagger. Who sent her? The Order must be stopped.' }],
    sceneCard: null,
});

const rlmResults = await rlmRetrieve({
    episodes: allEpisodes,
    queryContext: rlmQueryContext,
    llmCallFn: openRouterCall,
    chunkSize: 10,
    maxResults: 3,
    keywordFallbackFn: () => scoreEpisodes(allEpisodes, rlmQueryContext),
});

if (rlmResults.length === 0) {
    skip('rlm', 'RLM retrieval results', 'No results returned');
} else {
    assert('rlm', 'RLM returned results', rlmResults.length > 0, `got ${rlmResults.length}`);

    const rlmTop = rlmResults[0]?.item;
    assert('rlm', 'Betrayal episode in top results',
        rlmResults.some(r => r.item?.id === 'ep_betrayal'),
        `top IDs: [${rlmResults.slice(0, 3).map(r => r.item?.id).join(', ')}]`);

    assert('rlm', 'Betrayal episode ranks #1',
        rlmTop?.id === 'ep_betrayal',
        `top="${rlmTop?.title}" (${rlmTop?.id})`);

    assert('rlm', 'Results have rlm_relevant reason',
        rlmResults[0]?.reasons?.includes('rlm_relevant'),
        `reasons: [${rlmResults[0]?.reasons}]`);

    console.log(`  RLM ranking: ${rlmResults.slice(0, 5).map((r, i) => `${i + 1}. ${r.item?.title} (s=${r.score})`).join(', ')}`);

    // Compare with keyword scoring
    const keywordResults = scoreEpisodes(allEpisodes, rlmQueryContext);
    const keywordTop = keywordResults[0]?.item;
    console.log(`  Keyword top: ${keywordTop?.title} (s=${keywordResults[0]?.score})`);
    console.log(`  RLM top:     ${rlmTop?.title} (s=${rlmResults[0]?.score})`);
}

// --- Results ---

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
}

const verdict = failed === 0 ? 'PASS' : 'FAIL';
console.log(`\nVerdict: ${verdict}`);
process.exit(failed > 0 ? 1 : 0);
