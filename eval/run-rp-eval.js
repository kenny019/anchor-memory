import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildQueryContext } from '../retrieval/query-builder.js';
import { scoreEpisodes } from '../retrieval/score-episodes.js';
import { rlmRetrieve } from '../retrieval/rlm-retriever.js';
import { createSceneCard, mergeSceneCard } from '../models/state-cards.js';
import { extractStateUpdates } from '../writing/extract-state.js';
import { buildEpisodeCandidate } from '../writing/build-episode.js';

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

// --- Main ---

console.log('\n=== RP Benchmark: Keyword vs RLM on RP Data ===\n');

const dataPath = join(__dirname, 'data', 'rp-opus-subset.json');
if (!existsSync(dataPath)) {
    console.error('ERROR: No RP data found. Run first: npm run eval:rp:gen');
    process.exit(1);
}

const rawData = JSON.parse(readFileSync(dataPath, 'utf-8'));
const conversations = rawData.conversations || [];

// Build episodes for conversations that don't have them
for (const conv of conversations) {
    if (!conv.episodes || conv.episodes.length === 0) {
        conv.episodes = buildEpisodesForConv(conv.messages);
        console.log(`  Built ${conv.episodes.length} episodes for ${conv.characterName}`);
    }
}

function buildEpisodesForConv(messages) {
    const episodes = [];
    let sceneCard = createSceneCard();
    let lastBoundary = -1;
    const threshold = 10;
    for (let i = threshold - 1; i < messages.length; i += Math.floor(threshold / 2)) {
        const batch = messages.slice(0, i + 1);
        const stateUpdate = extractStateUpdates({ recentMessages: batch.slice(-12) });
        sceneCard = mergeSceneCard(sceneCard, stateUpdate, { updatedAtMessageId: i, updatedAtTs: Date.now() });
        const candidate = buildEpisodeCandidate({
            chatState: { sceneCard, episodes, lastEpisodeBoundaryMessageId: lastBoundary },
            recentMessages: batch,
            settings: { sceneMessageThreshold: threshold },
        });
        if (candidate) { episodes.push(candidate); lastBoundary = candidate.messageEnd; }
    }
    return episodes;
}

const allResults = { keyword: { span: [], contain: [] }, rlm: { span: [], contain: [] } };
const categoryResults = {};

for (const conv of conversations) {
    if (!conv.probes?.length || !conv.episodes?.length) {
        console.log(`  Skipping ${conv.characterName}: no probes or episodes`);
        continue;
    }

    console.log(`\n--- ${conv.characterName} (${conv.messages.length} msgs, ${conv.episodes.length} episodes, ${conv.probes.length} probes) ---\n`);

    for (const probe of conv.probes) {
        const queryContext = buildQueryContext({
            recentMessages: [{ text: probe.question }],
            sceneCard: null,
        });

        // Keyword
        const kwScored = scoreEpisodes(conv.episodes, queryContext);
        const kwTop3 = kwScored.slice(0, 3).map(s => s.item);
        const kwSpan = spanOverlap(kwTop3, probe.sourceRange);
        const kwContain = answerContainment(kwTop3, probe.answer, conv.messages);

        // RLM
        const rlmScored = await rlmRetrieve({
            episodes: conv.episodes,
            queryContext,
            llmCallFn: openRouterCall,
            chunkSize: 10,
            maxResults: 3,
            keywordFallbackFn: () => scoreEpisodes(conv.episodes, queryContext),
        });
        const rlmTop3 = rlmScored.slice(0, 3).map(s => s.item);
        const rlmSpan = spanOverlap(rlmTop3, probe.sourceRange);
        const rlmContain = answerContainment(rlmTop3, probe.answer, conv.messages);

        allResults.keyword.span.push(kwSpan ? 1 : 0);
        allResults.keyword.contain.push(kwContain);
        allResults.rlm.span.push(rlmSpan ? 1 : 0);
        allResults.rlm.contain.push(rlmContain);

        const cat = probe.category || 'unknown';
        if (!categoryResults[cat]) categoryResults[cat] = { kw: [], rlm: [] };
        categoryResults[cat].kw.push(kwSpan ? 1 : 0);
        categoryResults[cat].rlm.push(rlmSpan ? 1 : 0);

        const winner = rlmSpan && !kwSpan ? 'RLM' : kwSpan && !rlmSpan ? 'KW' : kwSpan && rlmSpan ? 'BOTH' : 'MISS';
        console.log(`  [${cat}] "${probe.question.slice(0, 60)}..." span: KW=${kwSpan ? 'HIT' : 'MISS'} RLM=${rlmSpan ? 'HIT' : 'MISS'} → ${winner}`);
    }

    // Coverage check
    const allEpSpans = conv.episodes;
    const cov = coverageRatio(allEpSpans, conv.messages.length);
    if (cov > 0.7) {
        console.log(`  ⚠ Coverage ${(cov * 100).toFixed(0)}% — small haystack, results may not discriminate`);
    }
}

// --- Summary ---

const mean = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const total = allResults.keyword.span.length;

console.log('\n' + '='.repeat(65));
console.log('RESULTS');
console.log('='.repeat(65));

console.log(`\nSpan Overlap (binary: did retriever find the right section?):`);
console.log(`  Keyword: ${(mean(allResults.keyword.span) * 100).toFixed(1)}% hit rate (${allResults.keyword.span.filter(x => x).length}/${total})`);
console.log(`  RLM:     ${(mean(allResults.rlm.span) * 100).toFixed(1)}% hit rate (${allResults.rlm.span.filter(x => x).length}/${total})`);

console.log(`\nAnswer Containment (% of answer tokens in retrieved text):`);
console.log(`  Keyword: ${(mean(allResults.keyword.contain) * 100).toFixed(1)}%`);
console.log(`  RLM:     ${(mean(allResults.rlm.contain) * 100).toFixed(1)}%`);

if (Object.keys(categoryResults).length > 0) {
    console.log(`\nBy Category (span overlap):`);
    for (const [cat, scores] of Object.entries(categoryResults)) {
        const kwRate = (mean(scores.kw) * 100).toFixed(0);
        const rlmRate = (mean(scores.rlm) * 100).toFixed(0);
        console.log(`  ${cat.padEnd(15)} KW=${kwRate}% RLM=${rlmRate}%`);
    }
}

const rlmWins = allResults.rlm.span.filter((r, i) => r && !allResults.keyword.span[i]).length;
const kwWins = allResults.keyword.span.filter((r, i) => r && !allResults.rlm.span[i]).length;
const bothHit = allResults.rlm.span.filter((r, i) => r && allResults.keyword.span[i]).length;
const bothMiss = allResults.rlm.span.filter((r, i) => !r && !allResults.keyword.span[i]).length;

console.log(`\nHead-to-head: RLM-only wins ${rlmWins}, KW-only wins ${kwWins}, both hit ${bothHit}, both miss ${bothMiss}`);
console.log(`Total tokens: ${totalTokens} (~$${(totalTokens * 0.0000001).toFixed(4)})`);

const winner = mean(allResults.rlm.span) > mean(allResults.keyword.span) ? 'RLM' : mean(allResults.rlm.span) < mean(allResults.keyword.span) ? 'KEYWORD' : 'TIE';
console.log(`\nOverall winner: ${winner}`);
