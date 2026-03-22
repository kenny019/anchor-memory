import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractStateUpdates } from '../writing/extract-state.js';
import { llmExtractScene } from '../writing/llm-extract-state.js';
import { CHAT_MESSAGES, CHECKPOINTS } from './fixture.js';

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
            max_tokens: maxTokens || 250,
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

// --- Scoring helpers ---

function fieldMatch(extracted, expected) {
    if (!expected && !extracted) return true;
    if (!expected) return true;
    if (!extracted) return false;
    return String(extracted).toLowerCase().includes(String(expected).toLowerCase());
}

// Lenient: check if key content words from expected appear in extracted
function lenientFieldMatch(extracted, expected) {
    if (!expected && !extracted) return true;
    if (!expected) return true;
    if (!extracted) return false;
    const keywords = String(expected).toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (keywords.length === 0) return true;
    const extractedLower = String(extracted).toLowerCase();
    const matched = keywords.filter(w => extractedLower.includes(w)).length;
    return matched >= Math.ceil(keywords.length * 0.5);
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

function msgsUpTo(id) {
    return CHAT_MESSAGES.filter(m => m.id <= id);
}

function scoreResult(result, expected, lenient = false) {
    const match = lenient ? lenientFieldMatch : fieldMatch;
    const fields = [];
    fields.push({ name: 'location', pass: match(result.location, expected.location) });
    if (expected.timeContext) {
        fields.push({ name: 'timeContext', pass: match(result.timeContext, expected.timeContext) });
    }
    if (expected.activeGoal) {
        fields.push({ name: 'activeGoal', pass: match(result.activeGoal, expected.activeGoal) });
    }
    if (expected.activeConflict) {
        fields.push({ name: 'activeConflict', pass: match(result.activeConflict, expected.activeConflict) });
    }
    fields.push({ name: 'participants', pass: participantsMatch(result.participants, expected.participants) });
    if (expected.openThreads?.length > 0) {
        fields.push({ name: 'openThreads', pass: threadsMatch(result.openThreads, expected.openThreads) });
    }
    return fields;
}

// --- Main ---

console.log('\n=== Extraction Quality: LLM vs Heuristic ===\n');

const heuristicStrict = { total: 0, passed: 0 };
const llmStrict = { total: 0, passed: 0 };
const heuristicLenient = { total: 0, passed: 0 };
const llmLenient = { total: 0, passed: 0 };

for (const cp of CHECKPOINTS) {
    const messages = msgsUpTo(cp.afterMessageId);

    const heuristicResult = extractStateUpdates({ recentMessages: messages });
    const llmResult = await llmExtractScene({
        recentMessages: messages,
        chatState: {},
        llmCallFn: openRouterCall,
    });

    const hStrict = scoreResult(heuristicResult, cp.expected, false);
    const lStrict = scoreResult(llmResult, cp.expected, false);
    const hLen = scoreResult(heuristicResult, cp.expected, true);
    const lLen = scoreResult(llmResult, cp.expected, true);

    console.log(`--- ${cp.label} (after msg ${cp.afterMessageId}) ---`);

    for (let i = 0; i < hStrict.length; i++) {
        heuristicStrict.total++; llmStrict.total++;
        heuristicLenient.total++; llmLenient.total++;
        if (hStrict[i].pass) heuristicStrict.passed++;
        if (lStrict[i].pass) llmStrict.passed++;
        if (hLen[i].pass) heuristicLenient.passed++;
        if (lLen[i].pass) llmLenient.passed++;

        const fieldName = hStrict[i].name.padEnd(16);
        const hs = hStrict[i].pass ? 'PASS' : 'FAIL';
        const ls = lStrict[i].pass ? 'PASS' : 'FAIL';
        const ll = lLen[i].pass ? 'PASS' : 'FAIL';
        console.log(`  ${fieldName} Heuristic: ${hs}  |  LLM(strict): ${ls}  |  LLM(lenient): ${ll}`);
    }

    console.log(`  [H] loc="${heuristicResult.location}" goal="${heuristicResult.activeGoal}" participants=[${(heuristicResult.participants || []).join(', ')}]`);
    console.log(`  [L] loc="${llmResult.location}" goal="${llmResult.activeGoal}" participants=[${(llmResult.participants || []).join(', ')}]`);
    console.log(`  [H] threads=[${(heuristicResult.openThreads || []).join('; ')}]`);
    console.log(`  [L] threads=[${(llmResult.openThreads || []).join('; ')}]`);
    console.log('');
}

// --- Summary ---

const pct = (s) => (s.passed / s.total * 100).toFixed(1);

console.log('='.repeat(65));
console.log('RESULTS');
console.log('='.repeat(65));
console.log(`${''.padEnd(20)} ${'Strict'.padEnd(20)} ${'Lenient'.padEnd(20)}`);
console.log(`${'Heuristic'.padEnd(20)} ${(heuristicStrict.passed + '/' + heuristicStrict.total + ' (' + pct(heuristicStrict) + '%)').padEnd(20)} ${(heuristicLenient.passed + '/' + heuristicLenient.total + ' (' + pct(heuristicLenient) + '%)').padEnd(20)}`);
console.log(`${'LLM'.padEnd(20)} ${(llmStrict.passed + '/' + llmStrict.total + ' (' + pct(llmStrict) + '%)').padEnd(20)} ${(llmLenient.passed + '/' + llmLenient.total + ' (' + pct(llmLenient) + '%)').padEnd(20)}`);
console.log(`\nTokens: ${totalTokens} (~$${(totalTokens * 0.0000001).toFixed(4)})`);

if (llmLenient.passed >= heuristicLenient.passed) {
    console.log(`\n✓ LLM(lenient) >= Heuristic(lenient)`);
} else {
    console.log(`\n✗ LLM(lenient) < Heuristic(lenient) — needs prompt tuning`);
}
