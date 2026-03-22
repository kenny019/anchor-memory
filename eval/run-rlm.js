import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadBeamData } from './load-beam.js';
import { buildQueryContext } from '../retrieval/query-builder.js';
import { scoreEpisodes } from '../retrieval/score-episodes.js';
import { rlmRetrieve } from '../retrieval/rlm-retriever.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// --- Env loading ---

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

// --- OpenRouter caller ---

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
            max_tokens: maxTokens || 150,
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return { text: null, error: err.error?.message || `HTTP ${response.status}` };
    }

    const data = await response.json();
    const tokens = data.usage?.total_tokens || 0;
    totalTokens += tokens;
    return { text: data.choices?.[0]?.message?.content || null, error: null };
}

// --- Answer containment scoring ---

function tokenize(text) {
    return String(text || '').toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 3);
}

function answerContainment(retrievedEpisodes, answerText, allMessages) {
    const answerTokens = [...new Set(tokenize(answerText))];
    if (answerTokens.length === 0) return 0;

    // Check raw messages within each episode's span, not just summaries
    const retrievedText = retrievedEpisodes
        .map(ep => {
            const spanMsgs = allMessages.filter(m => m.id >= ep.messageStart && m.id <= ep.messageEnd);
            const msgText = spanMsgs.map(m => m.text).join(' ');
            return `${ep.title} ${ep.summary} ${msgText}`;
        })
        .join(' ')
        .toLowerCase();

    const hits = answerTokens.filter(t => retrievedText.includes(t));
    return hits.length / answerTokens.length;
}

// --- Main ---

console.log('\n=== BEAM Long-Context Benchmark: Keyword vs RLM ===\n');

const { messages, episodes, probes } = await loadBeamData({ maxProbes: 20 });

if (episodes.length === 0) {
    console.error('ERROR: No episodes built from BEAM data');
    process.exit(1);
}

if (probes.length === 0) {
    console.error('ERROR: No probing questions parsed');
    process.exit(1);
}

console.log(`\n  Running ${probes.length} probes against ${episodes.length} episodes...\n`);

const results = { keyword: [], rlm: [] };
const categoryResults = {};

for (let i = 0; i < probes.length; i++) {
    const probe = probes[i];
    process.stdout.write(`  Probe ${i + 1}/${probes.length} [${probe.category}]... `);

    const queryContext = buildQueryContext({
        recentMessages: [{ text: probe.question }],
        sceneCard: null,
    });

    // Keyword scoring
    const keywordScored = scoreEpisodes(episodes, queryContext);
    const keywordTop3 = keywordScored.slice(0, 3).map(s => s.item);
    const keywordScore = answerContainment(keywordTop3, probe.answer, messages);

    // RLM retrieval
    const rlmScored = await rlmRetrieve({
        episodes,
        queryContext,
        llmCallFn: openRouterCall,
        chunkSize: 10,
        maxResults: 3,
        keywordFallbackFn: () => scoreEpisodes(episodes, queryContext),
    });
    const rlmTop3 = rlmScored.slice(0, 3).map(s => s.item);
    const rlmScore = answerContainment(rlmTop3, probe.answer, messages);

    results.keyword.push(keywordScore);
    results.rlm.push(rlmScore);

    if (!categoryResults[probe.category]) {
        categoryResults[probe.category] = { keyword: [], rlm: [] };
    }
    categoryResults[probe.category].keyword.push(keywordScore);
    categoryResults[probe.category].rlm.push(rlmScore);

    const winner = rlmScore > keywordScore ? 'RLM' : keywordScore > rlmScore ? 'KW' : 'TIE';
    console.log(`KW=${(keywordScore * 100).toFixed(0)}% RLM=${(rlmScore * 100).toFixed(0)}% ${winner}`);
}

// --- Summary ---

const mean = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

console.log('\n' + '='.repeat(60));
console.log('RESULTS BY CATEGORY');
console.log('='.repeat(60));
console.log(`${'Category'.padEnd(30)} ${'Keyword'.padEnd(10)} ${'RLM'.padEnd(10)} Winner`);
console.log('-'.repeat(60));

for (const [cat, scores] of Object.entries(categoryResults)) {
    const kwMean = (mean(scores.keyword) * 100).toFixed(1);
    const rlmMean = (mean(scores.rlm) * 100).toFixed(1);
    const winner = mean(scores.rlm) > mean(scores.keyword) ? 'RLM' : mean(scores.keyword) > mean(scores.rlm) ? 'KW' : 'TIE';
    console.log(`${cat.padEnd(30)} ${(kwMean + '%').padEnd(10)} ${(rlmMean + '%').padEnd(10)} ${winner}`);
}

console.log('-'.repeat(60));
const kwOverall = (mean(results.keyword) * 100).toFixed(1);
const rlmOverall = (mean(results.rlm) * 100).toFixed(1);
const overallWinner = mean(results.rlm) > mean(results.keyword) ? 'RLM' : 'KW';
console.log(`${'OVERALL'.padEnd(30)} ${(kwOverall + '%').padEnd(10)} ${(rlmOverall + '%').padEnd(10)} ${overallWinner}`);

const rlmWins = results.rlm.filter((r, i) => r > results.keyword[i]).length;
const kwWins = results.rlm.filter((r, i) => r < results.keyword[i]).length;
const ties = results.rlm.filter((r, i) => r === results.keyword[i]).length;
console.log(`\nHead-to-head: RLM wins ${rlmWins}, KW wins ${kwWins}, ties ${ties}`);
console.log(`Total tokens used: ${totalTokens}`);
console.log(`Estimated cost: ~$${(totalTokens * 0.0000001).toFixed(4)}`);
