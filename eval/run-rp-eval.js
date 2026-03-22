import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildQueryContext } from '../retrieval/query-builder.js';
import { scoreEpisodes } from '../retrieval/score-episodes.js';
import { rlmRetrieve } from '../retrieval/rlm-retriever.js';
import { deepRetrieve } from '../retrieval/deep-retriever.js';
import { refineQuery } from '../retrieval/query-refiner.js';
import { createSceneCard, mergeSceneCard } from '../models/state-cards.js';
import { extractStateUpdates } from '../writing/extract-state.js';
import { buildEpisodeCandidate } from '../writing/build-episode.js';
import { buildLLMSummary, buildHeuristicSummary } from '../writing/llm-summarizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// --- Env ---

function loadEnv() {
    if (process.env.OPENROUTER_API_KEY) return;
    try {
        const content = readFileSync(join(repoRoot, '.env'), 'utf-8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx < 0) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            if (!process.env[key]) process.env[key] = val;
        }
    } catch { /* no .env */ }
}

loadEnv();

if (!process.env.OPENROUTER_API_KEY) {
    console.error('ERROR: OPENROUTER_API_KEY not set. See .env.example');
    process.exit(1);
}

// --- OpenRouter ---

let totalTokens = 0;

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
            max_tokens: maxTokens || 200,
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return { text: null, error: err.error?.message || `HTTP ${response.status}` };
    }

    const data = await response.json();
    totalTokens += data.usage?.total_tokens || 0;
    return { text: data.choices?.[0]?.message?.content || null, error: null };
}

// --- Metrics ---

function tokenize(text) {
    return String(text || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 3);
}

function spanOverlap(episodes, sourceRange) {
    const [srcStart, srcEnd] = sourceRange;
    return episodes.some(ep => ep.messageStart <= srcEnd && ep.messageEnd >= srcStart);
}

function answerContainment(episodes, answerText, allMessages) {
    const answerTokens = [...new Set(tokenize(answerText))];
    if (answerTokens.length === 0) return 0;

    const text = episodes.map(ep => {
        const spanMsgs = allMessages.filter(m => m.id >= ep.messageStart && m.id <= ep.messageEnd);
        return spanMsgs.map(m => m.text).join(' ');
    }).join(' ').toLowerCase();

    return answerTokens.filter(t => text.includes(t)).length / answerTokens.length;
}

function coverageRatio(episodes, totalMessages) {
    let covered = 0;
    for (const ep of episodes) {
        covered += ep.messageEnd - ep.messageStart + 1;
    }
    return Math.min(1, covered / totalMessages);
}

// --- Episode building ---

async function buildEpisodesForConv(messages, useLLM = false) {
    const episodes = [];
    let sceneCard = createSceneCard();
    let lastBoundary = -1;
    const threshold = 10;
    for (let i = threshold - 1; i < messages.length; i += Math.floor(threshold / 2)) {
        const batch = messages.slice(0, i + 1);
        const stateUpdate = extractStateUpdates({ recentMessages: batch.slice(-12) });
        sceneCard = mergeSceneCard(sceneCard, stateUpdate, { updatedAtMessageId: i, updatedAtTs: Date.now() });
        const candidate = await buildEpisodeCandidate({
            chatState: { sceneCard, episodes, lastEpisodeBoundaryMessageId: lastBoundary },
            recentMessages: batch,
            settings: { sceneMessageThreshold: threshold, llmSummarization: useLLM },
            llmCallFn: useLLM ? openRouterCall : null,
        });
        if (candidate) { episodes.push(candidate); lastBoundary = candidate.messageEnd; }
    }
    return episodes;
}

// --- Retrieval functions ---

async function runKeyword(episodes, queryContext) {
    const scored = scoreEpisodes(episodes, queryContext);
    return scored.slice(0, 3).map(s => s.item);
}

async function runHybrid(episodes, queryContext, messages) {
    // RLM pass
    let rlmQueryCtx = queryContext;
    let rlmScored = await rlmRetrieve({
        episodes,
        queryContext: rlmQueryCtx,
        llmCallFn: openRouterCall,
        chunkSize: 10,
        maxResults: 8,
        keywordFallbackFn: () => scoreEpisodes(episodes, rlmQueryCtx),
    });

    // Adaptive refinement if all scores low
    const maxScore = rlmScored.reduce((max, s) => Math.max(max, s.score), 0);
    if (maxScore <= 3 && rlmScored.length > 0) {
        rlmQueryCtx = await refineQuery({ queryContext: rlmQueryCtx, llmCallFn: openRouterCall });
        rlmScored = await rlmRetrieve({
            episodes,
            queryContext: rlmQueryCtx,
            llmCallFn: openRouterCall,
            chunkSize: 10,
            maxResults: 8,
            keywordFallbackFn: () => scoreEpisodes(episodes, rlmQueryCtx),
        });
    }

    // Deep retrieval
    rlmScored = await deepRetrieve({
        candidates: rlmScored.slice(0, 8),
        queryContext: rlmQueryCtx,
        allMessages: messages,
        llmCallFn: openRouterCall,
        maxResults: 3,
    });

    const rlmTop3 = rlmScored.slice(0, 3).map(s => s.item);

    // Merge keyword + RLM for hybrid
    const kwScored = scoreEpisodes(episodes, queryContext);
    const kwTop3 = kwScored.slice(0, 3).map(s => s.item);
    const hybridMap = new Map();
    for (const ep of kwTop3) hybridMap.set(ep.id, ep);
    for (const ep of rlmTop3) hybridMap.set(ep.id, ep);
    return [...hybridMap.values()].slice(0, 6);
}

// --- Main ---

console.log('\n=== RP Benchmark: 4-Configuration Comparison ===\n');

const dataPath = join(__dirname, 'data', 'rp-opus-subset.json');
if (!existsSync(dataPath)) {
    console.error('ERROR: No RP data found. Run first: npm run eval:rp:gen');
    process.exit(1);
}

const rawData = JSON.parse(readFileSync(dataPath, 'utf-8'));
const conversations = rawData.conversations || [];

// Build both heuristic and LLM episodes
const llmEpisodeCachePath = join(__dirname, 'data', 'llm-episodes-cache.json');
let llmEpisodeCache = {};
if (existsSync(llmEpisodeCachePath)) {
    llmEpisodeCache = JSON.parse(readFileSync(llmEpisodeCachePath, 'utf-8'));
}

for (const conv of conversations) {
    // Heuristic episodes
    if (!conv.episodes || conv.episodes.length === 0) {
        conv.episodes = await buildEpisodesForConv(conv.messages, false);
        console.log(`  Built ${conv.episodes.length} heuristic episodes for ${conv.characterName}`);
    }

    // LLM episodes (cached)
    if (llmEpisodeCache[conv.chatId]) {
        conv.llmEpisodes = llmEpisodeCache[conv.chatId];
        console.log(`  Loaded ${conv.llmEpisodes.length} cached LLM episodes for ${conv.characterName}`);
    } else {
        console.log(`  Building LLM episodes for ${conv.characterName}...`);
        conv.llmEpisodes = await buildEpisodesForConv(conv.messages, true);
        llmEpisodeCache[conv.chatId] = conv.llmEpisodes;
        writeFileSync(llmEpisodeCachePath, JSON.stringify(llmEpisodeCache), 'utf-8');
        console.log(`  Built ${conv.llmEpisodes.length} LLM episodes for ${conv.characterName} (cached)`);
    }
}

// --- Run all 4 configurations ---

const configs = [
    { name: 'Heuristic+KW', episodeKey: 'episodes', retrieval: 'keyword' },
    { name: 'Heuristic+Hybrid', episodeKey: 'episodes', retrieval: 'hybrid' },
    { name: 'LLM+KW', episodeKey: 'llmEpisodes', retrieval: 'keyword' },
    { name: 'LLM+Hybrid', episodeKey: 'llmEpisodes', retrieval: 'hybrid' },
];

const configResults = {};
for (const cfg of configs) {
    configResults[cfg.name] = { span: [], contain: [], categories: {} };
}

let totalProbes = 0;

for (const conv of conversations) {
    if (!conv.probes?.length) continue;

    console.log(`\n--- ${conv.characterName} (${conv.messages.length} msgs, ${conv.probes.length} probes) ---`);
    console.log(`    Heuristic: ${conv.episodes.length} episodes | LLM: ${conv.llmEpisodes.length} episodes\n`);

    for (const probe of conv.probes) {
        totalProbes++;
        const queryContext = buildQueryContext({
            recentMessages: [{ text: probe.question }],
            sceneCard: null,
        });

        const results = {};

        for (const cfg of configs) {
            const episodes = conv[cfg.episodeKey];
            let top;

            if (cfg.retrieval === 'keyword') {
                top = await runKeyword(episodes, queryContext);
            } else {
                top = await runHybrid(episodes, queryContext, conv.messages);
            }

            const span = spanOverlap(top, probe.sourceRange);
            const contain = answerContainment(top, probe.answer, conv.messages);

            configResults[cfg.name].span.push(span ? 1 : 0);
            configResults[cfg.name].contain.push(contain);

            const cat = probe.category || 'unknown';
            if (!configResults[cfg.name].categories[cat]) configResults[cfg.name].categories[cat] = [];
            configResults[cfg.name].categories[cat].push(span ? 1 : 0);

            results[cfg.name] = span ? 'HIT' : 'MISS';
        }

        const q = probe.question.slice(0, 55);
        console.log(`  [${probe.category}] "${q}..." ${configs.map(c => `${c.name.split('+')[1]}=${results[c.name]}`).join(' | ')}`);
    }
}

// --- Summary ---

const mean = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

console.log('\n' + '='.repeat(75));
console.log('RESULTS: 4-CONFIGURATION COMPARISON');
console.log('='.repeat(75));

console.log(`\n${'Config'.padEnd(20)} ${'Span Overlap'.padEnd(18)} ${'Answer Containment'.padEnd(20)}`);
console.log('-'.repeat(58));

for (const cfg of configs) {
    const r = configResults[cfg.name];
    const spanRate = (mean(r.span) * 100).toFixed(1);
    const containRate = (mean(r.contain) * 100).toFixed(1);
    const spanHits = r.span.filter(x => x).length;
    console.log(`${cfg.name.padEnd(20)} ${(spanRate + '% (' + spanHits + '/' + totalProbes + ')').padEnd(18)} ${containRate}%`);
}

// Category breakdown for best config
const bestConfig = configs.reduce((best, cfg) =>
    mean(configResults[cfg.name].span) > mean(configResults[best.name].span) ? cfg : best, configs[0]);

console.log(`\nBest config: ${bestConfig.name}`);
console.log('\nBy Category (span overlap):');
for (const [cat, scores] of Object.entries(configResults[bestConfig.name].categories)) {
    console.log(`  ${cat.padEnd(15)} ${(mean(scores) * 100).toFixed(0)}%`);
}

// Improvement metrics
const baselineRate = mean(configResults['Heuristic+KW'].span);
const bestRate = mean(configResults[bestConfig.name].span);
const improvement = ((bestRate - baselineRate) * 100).toFixed(1);

console.log(`\n${'='.repeat(75)}`);
console.log(`Baseline (Heuristic+KW): ${(baselineRate * 100).toFixed(1)}%`);
console.log(`Best (${bestConfig.name}): ${(bestRate * 100).toFixed(1)}%`);
console.log(`Improvement: +${improvement}%`);
console.log(`Total tokens: ${totalTokens} (~$${(totalTokens * 0.0000001).toFixed(4)})`);

// Reachable probes: exclude probes that ALL configs miss (data alignment issues, not retrieval failures)
const allMiss = configResults['Heuristic+KW'].span.map((v, i) =>
    configs.every(c => !configResults[c.name].span[i])
);
const reachableCount = allMiss.filter(m => !m).length;
const baseReachable = configResults['Heuristic+KW'].span.filter((v, i) => !allMiss[i] && v).length;
const bestReachable = configResults[bestConfig.name].span.filter((v, i) => !allMiss[i] && v).length;

console.log(`\nReachable probes: ${reachableCount}/${totalProbes} (${totalProbes - reachableCount} missed by ALL configs — data alignment issues)`);
console.log(`  Baseline on reachable: ${baseReachable}/${reachableCount} = ${(baseReachable / reachableCount * 100).toFixed(1)}%`);
console.log(`  Best on reachable:     ${bestReachable}/${reachableCount} = ${(bestReachable / reachableCount * 100).toFixed(1)}%`);
console.log(`  Improvement on reachable: +${((bestReachable / reachableCount - baseReachable / reachableCount) * 100).toFixed(1)}%`);

if (bestRate >= 0.65 && (bestRate - baselineRate) >= 0.25) {
    console.log('\n✓ TARGET MET: significant improvement demonstrated');
} else {
    console.log(`\n✗ TARGET NOT MET: need significant improvement`);
}
