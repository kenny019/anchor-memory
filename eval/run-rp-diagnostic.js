import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { formatMessagesForLLM } from '../writing/format-messages.js';
import { buildHeuristicSummary, buildLLMSummary, buildLLMEpisodeSummary } from '../writing/llm-summarizer.js';
import { llmExtractScene } from '../writing/llm-extract-state.js';
import { extractStateUpdates } from '../writing/extract-state.js';
import { extractStateWindowed } from '../writing/windowed-extractor.js';
import { buildEpisodeCandidate } from '../writing/build-episode.js';
import { createSceneCard, mergeSceneCard } from '../models/state-cards.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const LLM_MODE = process.argv.includes('--llm');

// --- Env loading (only for --llm) ---

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

let totalTokens = 0;

async function openRouterCall({ prompt, systemPrompt, maxTokens }) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: process.env.EVAL_MODEL || 'openai/gpt-5.4-nano',
                    messages: [
                        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                        { role: 'user', content: prompt },
                    ],
                    max_tokens: maxTokens || 300,
                    temperature: 0.3,
                }),
            });

            clearTimeout(timer);

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                return { text: null, error: err.error?.message || `HTTP ${response.status}` };
            }

            const data = await response.json();
            const tokens = data.usage?.total_tokens || 0;
            totalTokens += tokens;
            return { text: data.choices?.[0]?.message?.content || null, error: null };
        } catch (err) {
            if (attempt === 1) return { text: null, error: err.message || 'fetch failed' };
            console.log(`    (retry after ${err.message})`);
        }
    }
    return { text: null, error: 'exhausted retries' };
}

// Simulate OLD formatting (200-char per-message truncation)
function formatOld(msgs, maxMessages = 15) {
    return msgs.slice(-maxMessages).map(m => {
        const line = `${m.name || (m.isUser ? 'User' : 'Character')}: ${String(m.text || '')}`;
        return line.length > 200 ? `${line.slice(0, 197)}...` : line;
    }).join('\n');
}

// --- Test runner ---

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
const failures = [];

function assert(group, name, condition, detail = '') {
    if (condition) {
        totalPassed++;
    } else {
        totalFailed++;
        failures.push(`[${group}] ${name}${detail ? ': ' + detail : ''}`);
    }
    const icon = condition ? '  PASS' : '  FAIL';
    console.log(`${icon}  ${name}${detail && !condition ? ' — ' + detail : ''}`);
}

function skip(group, name, reason) {
    totalSkipped++;
    console.log(`  SKIP  ${name} — ${reason}`);
}

// --- Section 1: JSONL Parsing ---

console.log('\n=== Section 1: JSONL Parsing ===');

const dataDir = join(__dirname, '..', 'data');
const jsonlFiles = readdirSync(dataDir).filter(f => f.startsWith('Narrator') && f.endsWith('.jsonl'));
if (jsonlFiles.length === 0) {
    console.error('No Narrator JSONL file found in data/');
    process.exit(1);
}
const jsonlPath = join(dataDir, jsonlFiles[0]);
const rawLines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean);

const metadata = JSON.parse(rawLines[0]);
const storedEpisodes = metadata.chat_metadata?.anchor_memory?.episodes || [];
const storedSceneCard = metadata.chat_metadata?.anchor_memory?.sceneCard || {};

const messages = rawLines.slice(1).map((line, idx) => {
    const obj = JSON.parse(line);
    return {
        id: idx,
        isUser: !!obj.is_user,
        name: obj.name || (obj.is_user ? 'User' : 'Character'),
        text: String(obj.mes || ''),
    };
});

console.log(`  Loaded ${messages.length} messages from ${jsonlFiles[0]}`);
console.log(`  Stored episodes: ${storedEpisodes.length}`);
assert('parse', 'Messages loaded', messages.length > 0);
assert('parse', 'Metadata has episodes', storedEpisodes.length > 0);

// --- Section 2: Message Stats ---

console.log('\n=== Section 2: Message Stats ===');

const lengths = messages.map(m => m.text.length);
const sorted = [...lengths].sort((a, b) => a - b);
const avg = Math.round(lengths.reduce((s, l) => s + l, 0) / lengths.length);
const median = sorted[Math.floor(sorted.length / 2)];
const p95 = sorted[Math.floor(sorted.length * 0.95)];
let truncatedCount = 0;

for (const m of messages) {
    const len = m.text.length;
    const flag = len > 200 ? ' [TRUNCATED @ 200]' : '';
    if (len > 200) truncatedCount++;
    console.log(`  msg ${m.id}: ${m.name.padEnd(12)} ${len.toString().padStart(5)} chars  "${m.text.slice(0, 80).replace(/\n/g, ' ')}..."${flag}`);
}

console.log(`\n  avg=${avg} median=${median} p95=${p95} truncated_at_200=${truncatedCount}/${messages.length}`);
assert('stats', 'Some messages exceed 200 chars', truncatedCount > 0, `${truncatedCount} msgs`);

// --- Section 3: Truncation Comparison ---

console.log('\n=== Section 3: Truncation Comparison (Old 200-char vs New Budget) ===');

const OLD_LIMIT = 200;

for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const rawLine = `${m.name}: ${m.text}`;
    const oldTrunc = rawLine.length > OLD_LIMIT ? rawLine.slice(0, OLD_LIMIT - 3) + '...' : rawLine;

    const allRaw = messages.map(msg => `${msg.name}: ${msg.text}`);
    const totalRaw = allRaw.reduce((s, l) => s + l.length, 0);
    const share = Math.floor((rawLine.length / totalRaw) * 3000);
    const newLen = Math.min(rawLine.length, Math.max(80, share));

    const oldPct = rawLine.length > 0 ? Math.round((oldTrunc.length / rawLine.length) * 100) : 100;
    const newPct = rawLine.length > 0 ? Math.round((newLen / rawLine.length) * 100) : 100;
    const loss = rawLine.length > OLD_LIMIT ? `${100 - oldPct}% lost` : 'no loss';

    console.log(`  msg ${i}: raw=${rawLine.length} old=${oldTrunc.length}(${oldPct}%) new~=${newLen}(${newPct}%) [old: ${loss}]`);
}

// --- Section 4: LLM Prompt Simulation ---

console.log('\n=== Section 4: LLM Prompt Simulation ===');

const callSites = [
    { name: 'buildLLMSummary', budget: 3000, maxMsgs: 15 },
    { name: 'buildLLMEpisodeSummary', budget: 4000, maxMsgs: 15 },
    { name: 'llmExtractScene', budget: 3500, maxMsgs: 12 },
];

for (const site of callSites) {
    console.log(`\n  --- ${site.name} (budget=${site.budget}, maxMsgs=${site.maxMsgs}) ---`);
    const recent = messages.slice(-site.maxMsgs);

    const oldFormatted = recent.map(m => {
        const line = `${m.name}: ${m.text}`;
        return line.length > OLD_LIMIT ? `${line.slice(0, OLD_LIMIT - 3)}...` : line;
    }).join('\n');

    const newFormatted = formatMessagesForLLM(recent, { totalBudget: site.budget, maxMessages: site.maxMsgs });

    console.log(`  Old total: ${oldFormatted.length} chars`);
    console.log(`  New total: ${newFormatted.length} chars (budget: ${site.budget})`);
    assert('prompt', `${site.name} new within budget`, newFormatted.length <= site.budget,
        `got ${newFormatted.length}`);
}

// --- Section 5: Heuristic Pipeline Run ---

console.log('\n=== Section 5: Heuristic Pipeline Run ===');

let sceneCard = createSceneCard();
const episodes = [];
let lastBoundary = -1;

for (let i = 0; i < messages.length; i++) {
    const batch = messages.slice(0, i + 1);
    const stateUpdate = extractStateUpdates({ recentMessages: batch });
    sceneCard = mergeSceneCard(sceneCard, stateUpdate, {
        updatedAtMessageId: i,
        updatedAtTs: Date.now(),
    });

    const candidate = await buildEpisodeCandidate({
        chatState: { sceneCard, episodes, lastEpisodeBoundaryMessageId: lastBoundary },
        recentMessages: batch,
        settings: { sceneMessageThreshold: 6 },
    });

    if (candidate) {
        episodes.push(candidate);
        lastBoundary = candidate.messageEnd;
        console.log(`  Episode created: msgs ${candidate.messageStart}-${candidate.messageEnd} "${candidate.title}"`);
        console.log(`    Summary: ${candidate.summary.slice(0, 200)}...`);
    }
}

console.log(`\n  Generated ${episodes.length} episodes vs ${storedEpisodes.length} stored`);
assert('pipeline', 'At least 1 episode created', episodes.length >= 1);

for (const stored of storedEpisodes) {
    console.log(`  Stored: msgs ${stored.messageStart}-${stored.messageEnd} "${stored.title}"`);
    console.log(`    Summary: ${stored.summary.slice(0, 200)}...`);
}

// --- Section 6: Bug Verification (Message 8) ---

console.log('\n=== Section 6: Bug Verification — Message 8 ===');

const msg8 = messages[8];
if (msg8) {
    const rawLine = `${msg8.name}: ${msg8.text}`;
    console.log(`  Message 8: ${rawLine.length} chars, speaker: ${msg8.name}`);

    const oldTrunc = rawLine.length > OLD_LIMIT ? rawLine.slice(0, OLD_LIMIT - 3) + '...' : rawLine;
    console.log(`  Old (200-char): "${oldTrunc.slice(0, 120)}..."`);

    const context = messages.slice(7, 10);
    const newContextFormatted = formatMessagesForLLM(context, { totalBudget: 3000, maxMessages: 15 });
    console.log(`  New (budget, msgs 7-9): ${newContextFormatted.length} chars total`);
    console.log(`  New msg8 preview: "${newContextFormatted.slice(0, 200).replace(/\n/g, ' ')}..."`);

    const heuristicResult = buildHeuristicSummary(messages.slice(6, 10), []);
    console.log(`  Heuristic (msgs 6-9): "${heuristicResult.slice(0, 200).replace(/\n/g, ' ')}..."`);

    const keyFacts = ['burning', 'soldiers', 'green-haired', 'Ainz'];
    for (const fact of keyFacts) {
        const inOld = oldTrunc.toLowerCase().includes(fact.toLowerCase());
        const inNew = newContextFormatted.toLowerCase().includes(fact.toLowerCase());
        const inHeuristic = heuristicResult.toLowerCase().includes(fact.toLowerCase());
        const status = !inOld && (inNew || inHeuristic) ? 'FIXED' : inOld ? 'already ok' : !inNew && !inHeuristic ? 'MISSING' : 'ok';
        console.log(`    "${fact}": old=${inOld} new=${inNew} heuristic=${inHeuristic} [${status}]`);

        if (rawLine.toLowerCase().includes(fact.toLowerCase())) {
            assert('bug', `msg8 "${fact}" survives in new or heuristic`, inNew || inHeuristic);
        }
    }
} else {
    console.log('  Message 8 not found (only ' + messages.length + ' messages)');
}

// --- Section 7: formatMessagesForLLM Unit Tests ---

console.log('\n=== Section 7: formatMessagesForLLM Unit Tests ===');

assert('unit', '0 messages returns empty', formatMessagesForLLM([], { totalBudget: 1000 }) === '');
assert('unit', 'null returns empty', formatMessagesForLLM(null, { totalBudget: 1000 }) === '');

const oneShort = [{ name: 'A', text: 'hello' }];
assert('unit', '1 short msg untruncated', formatMessagesForLLM(oneShort, { totalBudget: 1000 }) === 'A: hello');

const allShort = [
    { name: 'A', text: 'hi' },
    { name: 'B', text: 'hey' },
    { name: 'C', text: 'yo' },
];
const allShortResult = formatMessagesForLLM(allShort, { totalBudget: 1000 });
assert('unit', 'all short msgs untruncated', allShortResult === 'A: hi\nB: hey\nC: yo');

const longMsgs = [
    { name: 'A', text: 'x'.repeat(500) },
    { name: 'B', text: 'y'.repeat(500) },
];
const tinyBudget = formatMessagesForLLM(longMsgs, { totalBudget: 100 });
assert('unit', 'tiny budget still produces output', tinyBudget.length > 0);
assert('unit', 'tiny budget respects minimum floor', tinyBudget.includes('...'));

const mixed = [
    { name: 'Short', text: 'hi' },
    { name: 'Long', text: 'z'.repeat(2000) },
];
const mixedResult = formatMessagesForLLM(mixed, { totalBudget: 500 });
assert('unit', 'mixed: short msg preserved', mixedResult.includes('Short: hi'));
assert('unit', 'mixed: long msg truncated', mixedResult.includes('...'));
assert('unit', 'mixed: total within 2x budget', mixedResult.length < 1000,
    `got ${mixedResult.length}`);

const manyMsgs = Array.from({ length: 20 }, (_, i) => ({ name: `U${i}`, text: `msg${i}` }));
const limited = formatMessagesForLLM(manyMsgs, { totalBudget: 5000, maxMessages: 5 });
assert('unit', 'maxMessages limits to last N', limited.split('\n').length === 5);

// ====================================================================
// LLM QUALITY TESTS (--llm flag)
// ====================================================================

if (LLM_MODE) {
    loadEnv();

    if (!process.env.OPENROUTER_API_KEY) {
        console.error('\nERROR: OPENROUTER_API_KEY not set. See .env.example');
        process.exit(1);
    }

    const model = process.env.EVAL_MODEL || 'openai/gpt-5.4-nano';
    console.log(`\n${'='.repeat(60)}`);
    console.log(`LLM QUALITY TESTS (model: ${model})`);
    console.log('='.repeat(60));

    // Key narrative facts from the full message corpus that a good summary should capture.
    // Grouped by message range for targeted verification.
    const FACT_BANK = {
        // msgs 0-2: knight killed, Ainz introduces himself, village in danger
        early: {
            range: [0, 2],
            facts: ['Grasp Heart', 'Ainz', 'Carne Village', 'knight'],
            label: 'Ainz encounter (msgs 0-2)',
        },
        // msgs 3-6: blue orb, Ainz contemplation
        mid: {
            range: [3, 6],
            facts: ['orb', 'crystalline', 'blue'],
            label: 'Blue orb (msgs 3-6)',
        },
        // msgs 7-8: travel back + village attack (THE BUG)
        attack: {
            range: [7, 8],
            facts: ['burning', 'soldiers', 'Ainz', 'village'],
            label: 'Village attack (msgs 7-8)',
        },
        // msgs 9-14: hiding, ambush, combat, sword, family escape
        combat: {
            range: [9, 14],
            facts: ['soldier', 'sword', 'ambush', 'family'],
            label: 'Combat & escape (msgs 9-14)',
        },
    };

    function scoreFacts(text, facts) {
        const lower = (text || '').toLowerCase();
        const hits = facts.filter(f => lower.includes(f.toLowerCase()));
        return { hits, total: facts.length, pct: Math.round((hits.length / facts.length) * 100) };
    }

    // Collect results across sections for the scorecard
    let oldSummary = '(skipped)', newSummary = '(skipped)';
    let oldEpText = '', newEpText = '';

    // --- Section 8: Old vs New LLM Summary ---

    console.log('\n=== Section 8: LLM Summary — Old vs New Truncation ===');
    try {
        const summaryMsgs = messages.slice(7, 10); // msgs 7-9 (the attack episode)
        const summaryLocations = ['Carne Village'];

        const oldSummaryFormatted = formatOld(summaryMsgs);
        const oldSummaryPrompt = `Summarize these roleplay messages into a concise memory entry. Preserve: specific character names, important objects, locations, emotional states, causal relationships (X happened because Y), and unresolved questions. Max 3 sentences, under 500 characters.\nLocations: Carne Village\n\nMessages:\n${oldSummaryFormatted}`;

        console.log('  Calling LLM (old formatting)...');
        const oldSummaryResult = await openRouterCall({
            prompt: oldSummaryPrompt,
            systemPrompt: 'You are a concise memory recorder for a roleplay session.',
            maxTokens: 200,
        });

        console.log('  Calling LLM (new formatting)...');
        const newSummaryText = await buildLLMSummary(summaryMsgs, summaryLocations, openRouterCall);

        oldSummary = oldSummaryResult.text || '(LLM error)';
        newSummary = newSummaryText || '(LLM error)';

        console.log(`\n  OLD input (${oldSummaryFormatted.length} chars):`);
        console.log(`    "${oldSummaryFormatted.slice(0, 200).replace(/\n/g, ' ')}..."`);
        console.log(`  OLD output: "${oldSummary}"`);

        const newSummaryInput = formatMessagesForLLM(summaryMsgs, { totalBudget: 3000, maxMessages: 15 });
        console.log(`\n  NEW input (${newSummaryInput.length} chars):`);
        console.log(`    "${newSummaryInput.slice(0, 200).replace(/\n/g, ' ')}..."`);
        console.log(`  NEW output: "${newSummary}"`);

        const oldAttackScore = scoreFacts(oldSummary, FACT_BANK.attack.facts);
        const newAttackScore = scoreFacts(newSummary, FACT_BANK.attack.facts);

        console.log(`\n  Attack facts — old: ${oldAttackScore.hits.join(',')||'none'} (${oldAttackScore.pct}%) | new: ${newAttackScore.hits.join(',')||'none'} (${newAttackScore.pct}%)`);
        assert('llm-summary', 'New summary captures more attack facts than old',
            newAttackScore.hits.length >= oldAttackScore.hits.length,
            `old=${oldAttackScore.hits.length}/${oldAttackScore.total} new=${newAttackScore.hits.length}/${newAttackScore.total}`);
        assert('llm-summary', 'New summary mentions village attack content',
            newAttackScore.hits.length >= 2,
            `got ${newAttackScore.hits.length}/${newAttackScore.total}: [${newAttackScore.hits}]`);
    } catch (err) {
        skip('llm-summary', 'Section 8', err.message);
    }

    // --- Section 9: LLM Episode Summary — Old vs New ---

    console.log('\n=== Section 9: LLM Episode Summary — Old vs New ===');
    try {
        const episodeMsgs = messages.slice(7, 15); // msgs 7-14 (village attack through combat)
        const episodeScene = { location: 'Carne Village', participants: ['Han Qi', 'Narrator'] };

        const oldEpFormatted = formatOld(episodeMsgs);
        const oldEpPrompt = `Summarize this roleplay episode into a memory entry.

Messages:
Location: Carne Village
Participants: Han Qi, Narrator
${oldEpFormatted}

Return JSON:
{
  "title": "short descriptive title (max 80 chars)",
  "summary": "2-3 sentences preserving character names and causal relationships (max 400 chars)",
  "tags": ["tag1", "tag2"],
  "significance": 3,
  "keyFacts": ["specific fact 1", "specific fact 2"]
}

Focus on: what changed, who did what to whom, what remains unresolved, why it matters.`;

        console.log('  Calling LLM (old formatting)...');
        const oldEpResult = await openRouterCall({
            prompt: oldEpPrompt,
            systemPrompt: 'You write concise memory entries for roleplay. Return ONLY valid JSON.',
            maxTokens: 300,
        });

        console.log('  Calling LLM (new formatting)...');
        const newEpResult = await buildLLMEpisodeSummary(episodeMsgs, episodeScene, openRouterCall);

        let oldEpParsed = null;
        try {
            const match = (oldEpResult.text || '').match(/\{[\s\S]*\}/);
            if (match) oldEpParsed = JSON.parse(match[0]);
        } catch { /* parse error */ }

        console.log(`\n  OLD input: ${oldEpFormatted.length} chars`);
        console.log(`  OLD title:   "${oldEpParsed?.title || '(parse fail)'}"`);
        console.log(`  OLD summary: "${(oldEpParsed?.summary || '(parse fail)').slice(0, 200)}"`);
        console.log(`  OLD keyFacts: ${JSON.stringify(oldEpParsed?.keyFacts || [])}`);

        const newEpFormatted = formatMessagesForLLM(episodeMsgs, { totalBudget: 4000, maxMessages: 15 });
        console.log(`\n  NEW input: ${newEpFormatted.length} chars`);
        console.log(`  NEW title:   "${newEpResult?.title || '(LLM error)'}"`);
        console.log(`  NEW summary: "${(newEpResult?.summary || '(LLM error)').slice(0, 200)}"`);
        console.log(`  NEW keyFacts: ${JSON.stringify(newEpResult?.keyFacts || [])}`);

        const allFacts = [...FACT_BANK.attack.facts, ...FACT_BANK.combat.facts];
        oldEpText = `${oldEpParsed?.title || ''} ${oldEpParsed?.summary || ''} ${(oldEpParsed?.keyFacts || []).join(' ')}`;
        newEpText = `${newEpResult?.title || ''} ${newEpResult?.summary || ''} ${(newEpResult?.keyFacts || []).join(' ')}`;
        const oldEpScore = scoreFacts(oldEpText, allFacts);
        const newEpScore = scoreFacts(newEpText, allFacts);

        console.log(`\n  All narrative facts — old: ${oldEpScore.hits.join(',')||'none'} (${oldEpScore.pct}%) | new: ${newEpScore.hits.join(',')||'none'} (${newEpScore.pct}%)`);
        assert('llm-episode', 'New episode captures more facts than old',
            newEpScore.hits.length >= oldEpScore.hits.length,
            `old=${oldEpScore.hits.length}/${oldEpScore.total} new=${newEpScore.hits.length}/${newEpScore.total}`);
        assert('llm-episode', 'New episode captures majority of facts',
            newEpScore.pct >= 50,
            `got ${newEpScore.pct}%`);
    } catch (err) {
        skip('llm-episode', 'Section 9', err.message);
    }

    // --- Section 10: LLM Scene Extraction — Old vs New ---

    console.log('\n=== Section 10: LLM Scene Extraction — Old vs New ===');
    try {
        const sceneMsgs = messages.slice(7, 15);

        const oldSceneFormatted = formatOld(sceneMsgs, 12);
        const oldScenePrompt = `Analyze these recent roleplay messages.

Recent messages (last ${sceneMsgs.length}):
${oldSceneFormatted}

Previous scene state:
- Location: (none)
- Participants: (none)

Return JSON:
{
  "scene": {
    "location": "specific place name",
    "timeContext": "",
    "activeGoal": "what protagonist is trying to do",
    "activeConflict": "active tension or opposition",
    "openThreads": ["unresolved plot question"],
    "participants": ["character names"]
  }
}`;

        console.log('  Calling LLM (old formatting)...');
        const oldSceneResult = await openRouterCall({
            prompt: oldScenePrompt,
            systemPrompt: 'You analyze roleplay scenes. Return ONLY valid JSON.',
            maxTokens: 300,
        });

        console.log('  Calling LLM (new formatting)...');
        const newSceneResult = await llmExtractScene({
            recentMessages: sceneMsgs,
            chatState: {},
            llmCallFn: openRouterCall,
        });

        let oldSceneParsed = null;
        try {
            const match = (oldSceneResult.text || '').match(/\{[\s\S]*\}/);
            if (match) {
                const p = JSON.parse(match[0]);
                oldSceneParsed = p.scene || p;
            }
        } catch { /* parse error */ }

        console.log(`\n  OLD input: ${oldSceneFormatted.length} chars`);
        console.log(`  OLD location:       "${oldSceneParsed?.location || '(parse fail)'}"`);
        console.log(`  OLD activeConflict: "${oldSceneParsed?.activeConflict || ''}"`);
        console.log(`  OLD participants:   [${(oldSceneParsed?.participants || []).join(', ')}]`);
        console.log(`  OLD openThreads:    [${(oldSceneParsed?.openThreads || []).join('; ')}]`);

        console.log(`\n  NEW input: ${formatMessagesForLLM(sceneMsgs, { totalBudget: 3500, maxMessages: 12 }).length} chars`);
        console.log(`  NEW location:       "${newSceneResult?.location || '(LLM error)'}"`);
        console.log(`  NEW activeConflict: "${newSceneResult?.activeConflict || ''}"`);
        console.log(`  NEW participants:   [${(newSceneResult?.participants || []).join(', ')}]`);
        console.log(`  NEW openThreads:    [${(newSceneResult?.openThreads || []).join('; ')}]`);

        const newSceneText = `${newSceneResult?.location || ''} ${newSceneResult?.activeConflict || ''} ${(newSceneResult?.openThreads || []).join(' ')}`.toLowerCase();
        const oldSceneText = `${oldSceneParsed?.location || ''} ${oldSceneParsed?.activeConflict || ''} ${(oldSceneParsed?.openThreads || []).join(' ')}`.toLowerCase();

        assert('llm-scene', 'New scene detects location',
            (newSceneResult?.location || '').length > 0,
            `got "${newSceneResult?.location || ''}"`);
        assert('llm-scene', 'New scene has conflict',
            (newSceneResult?.activeConflict || '').length > 0,
            `got "${newSceneResult?.activeConflict || ''}"`);
        // Compare factual content rather than raw length (verbose != richer)
        const sceneFactsToCheck = ['village', 'soldier', 'family'];
        const oldSceneFacts = sceneFactsToCheck.filter(f => oldSceneText.includes(f));
        const newSceneFacts = sceneFactsToCheck.filter(f => newSceneText.includes(f));
        assert('llm-scene', 'New scene captures key narrative facts',
            newSceneFacts.length >= oldSceneFacts.length,
            `old=[${oldSceneFacts}] new=[${newSceneFacts}]`);
    } catch (err) {
        skip('llm-scene', 'Section 10', err.message);
    }

    // --- Section 11: Factual Completeness Scorecard ---

    console.log('\n=== Section 11: Factual Completeness Scorecard ===');

    console.log(`\n  ${'Fact Group'.padEnd(30)} ${'Old Summary'.padEnd(14)} ${'New Summary'.padEnd(14)} ${'Old Episode'.padEnd(14)} ${'New Episode'.padEnd(14)}`);
    console.log('  ' + '-'.repeat(86));

    let oldTotalHits = 0, newTotalHits = 0, oldEpTotalHits = 0, newEpTotalHits = 0, totalFactCount = 0;

    for (const [key, bank] of Object.entries(FACT_BANK)) {
        const os = scoreFacts(oldSummary, bank.facts);
        const ns = scoreFacts(newSummary, bank.facts);
        const oe = scoreFacts(oldEpText, bank.facts);
        const ne = scoreFacts(newEpText, bank.facts);

        oldTotalHits += os.hits.length;
        newTotalHits += ns.hits.length;
        oldEpTotalHits += oe.hits.length;
        newEpTotalHits += ne.hits.length;
        totalFactCount += bank.facts.length;

        const pad = s => `${s.hits.length}/${s.total} (${s.pct}%)`.padEnd(14);
        console.log(`  ${bank.label.padEnd(30)} ${pad(os)} ${pad(ns)} ${pad(oe)} ${pad(ne)}`);
    }

    console.log('  ' + '-'.repeat(86));
    const pct = (n, d) => d > 0 ? `${Math.round(n / d * 100)}%` : '0%';
    console.log(`  ${'TOTAL'.padEnd(30)} ${(oldTotalHits + '/' + totalFactCount + ' (' + pct(oldTotalHits, totalFactCount) + ')').padEnd(14)} ${(newTotalHits + '/' + totalFactCount + ' (' + pct(newTotalHits, totalFactCount) + ')').padEnd(14)} ${(oldEpTotalHits + '/' + totalFactCount + ' (' + pct(oldEpTotalHits, totalFactCount) + ')').padEnd(14)} ${(newEpTotalHits + '/' + totalFactCount + ' (' + pct(newEpTotalHits, totalFactCount) + ')').padEnd(14)}`);

    assert('scorecard', 'New summary total >= old summary total',
        newTotalHits >= oldTotalHits,
        `old=${oldTotalHits} new=${newTotalHits}`);
    assert('scorecard', 'New episode total >= old episode total',
        newEpTotalHits >= oldEpTotalHits,
        `old=${oldEpTotalHits} new=${newEpTotalHits}`);

    console.log(`\n  Total tokens used: ${totalTokens} (~$${(totalTokens * 0.0000001).toFixed(5)})`);

} else {
    console.log('\n  (LLM tests skipped — run with --llm to enable)');
}

// --- Final Report ---

console.log('\n' + '='.repeat(50));
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed${totalSkipped ? `, ${totalSkipped} skipped` : ''}`);

if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
}

const verdict = totalFailed === 0 ? 'PASS' : 'FAIL';
console.log(`\nVerdict: ${verdict}`);
process.exit(totalFailed > 0 ? 1 : 0);
