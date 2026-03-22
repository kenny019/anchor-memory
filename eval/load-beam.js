import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createEpisode } from '../models/episodes.js';
import { createSceneCard, mergeSceneCard } from '../models/state-cards.js';
import { extractStateUpdates } from '../writing/extract-state.js';
import { buildEpisodeCandidate } from '../writing/build-episode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, 'data', 'beam-100k.json');
const API_URL = 'https://datasets-server.huggingface.co/rows?dataset=Mohammadta/BEAM&config=default&split=100K&offset=0&length=1';

export async function loadBeamData({ conversationIndex = 0, maxProbes = 20 } = {}) {
    const raw = await fetchOrCache();
    const row = raw.rows[conversationIndex]?.row;
    if (!row) throw new Error(`No conversation at index ${conversationIndex}`);

    const messages = flattenChat(row.chat);
    const probes = parseProbes(row.probing_questions, maxProbes);
    const episodes = await buildEpisodesFromMessages(messages);

    console.log(`  Loaded BEAM conversation: ${messages.length} messages, ${episodes.length} episodes, ${probes.length} probes`);

    return { messages, episodes, probes, conversationId: row.conversation_id };
}

async function fetchOrCache() {
    if (existsSync(CACHE_PATH)) {
        return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    }

    console.log('  Fetching BEAM dataset from HuggingFace...');
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`HuggingFace API error: ${response.status}`);
    const data = await response.json();

    writeFileSync(CACHE_PATH, JSON.stringify(data), 'utf-8');
    console.log(`  Cached to ${CACHE_PATH}`);
    return data;
}

function flattenChat(chatSessions) {
    const messages = [];
    let globalId = 0;

    for (const session of chatSessions) {
        for (const msg of session) {
            messages.push({
                id: globalId++,
                isUser: msg.role === 'user',
                name: msg.role === 'user' ? 'User' : 'Assistant',
                text: cleanContent(msg.content),
            });
        }
    }

    return messages;
}

function cleanContent(content) {
    // Remove BEAM's internal markers like "->-> 1,1"
    return String(content || '').replace(/\s*->\s*->\s*\d+,\d+\s*$/g, '').trim();
}

function parseProbes(probeString, maxProbes) {
    // BEAM uses a complex nested Python dict. Extract question+answer pairs directly.
    // Questions use 'question' key, answers use 'ideal_answer' or 'ideal_response'.
    const probes = [];

    // Find all {question, ideal_answer/ideal_response} blocks
    // Match question field — handles embedded escaped quotes via \" pattern
    const questionPattern = /'question'\s*:\s*(?:'((?:[^'\\]|\\.)*?)'|"((?:[^"\\]|\\.)*?)")/g;
    const questions = [];
    let qMatch;
    while ((qMatch = questionPattern.exec(probeString)) !== null) {
        questions.push({ text: qMatch[1] || qMatch[2] || '', pos: qMatch.index });
    }

    for (const q of questions) {
        if (probes.length >= maxProbes) break;

        // Find the nearest ideal_answer or ideal_response after this question
        const afterQ = probeString.slice(q.pos, q.pos + 2000);
        const answerMatch = afterQ.match(/(?:'ideal_answer'|'ideal_response'|'answer')\s*:\s*(?:'((?:[^'\\]|\\.)*?)'|"((?:[^"\\]|\\.)*?)")/);
        const answer = (answerMatch?.[1] || answerMatch?.[2] || '').replace(/\\'/g, "'");

        // Find the nearest major category before this question
        const before = probeString.slice(0, q.pos);
        const catMatch = before.match(/'(abstention|contradiction_resolution|event_ordering|information_extraction|instruction_following|knowledge_update|multi_session_reasoning|preference_following|summarization|temporal_reasoning)'\s*:\s*\[(?!.*'(?:abstention|contradiction_resolution|event_ordering|information_extraction|instruction_following|knowledge_update|multi_session_reasoning|preference_following|summarization|temporal_reasoning)'\s*:\s*\[)/s);
        const category = catMatch?.[1] || 'unknown';

        probes.push({
            question: q.text.replace(/\\'/g, "'"),
            answer,
            category,
        });
    }

    return probes;
}

async function buildEpisodesFromMessages(messages) {
    const episodes = [];
    let sceneCard = createSceneCard();
    let lastBoundary = -1;
    const threshold = 10;

    for (let i = threshold - 1; i < messages.length; i += Math.floor(threshold / 2)) {
        const batch = messages.slice(0, i + 1);
        const stateUpdate = extractStateUpdates({ recentMessages: batch.slice(-12) });
        sceneCard = mergeSceneCard(sceneCard, stateUpdate, {
            updatedAtMessageId: i,
            updatedAtTs: Date.now(),
        });

        const candidate = await buildEpisodeCandidate({
            chatState: { sceneCard, episodes, lastEpisodeBoundaryMessageId: lastBoundary },
            recentMessages: batch,
            settings: { sceneMessageThreshold: threshold },
        });

        if (candidate) {
            episodes.push(candidate);
            lastBoundary = candidate.messageEnd;
        }
    }

    return episodes;
}
