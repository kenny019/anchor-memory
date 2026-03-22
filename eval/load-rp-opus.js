import { readFileSync, writeFileSync, existsSync, createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSceneCard, mergeSceneCard } from '../models/state-cards.js';
import { extractStateUpdates } from '../writing/extract-state.js';
import { buildEpisodeCandidate } from '../writing/build-episode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, 'data', 'rp-opus-subset.json');
const JSONL_PATH = join(__dirname, 'data', 'messages_remaining.jsonl');
const HF_API = 'https://huggingface.co/api/datasets/taozi555/rp-opus/parquet/default/train';

const TARGET_CONVERSATIONS = 5;
const MIN_MESSAGES = 30;

export async function loadRpOpusData({ maxProbes = 5, llmCallFn = null } = {}) {
    // Return cached if available (with probes already generated)
    if (existsSync(CACHE_PATH)) {
        const cached = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
        if (cached.conversations?.length > 0 && cached.conversations[0].probes?.length > 0) {
            console.log(`  Loaded cached rp-opus data: ${cached.conversations.length} conversations`);
            return cached;
        }
    }

    // Load raw conversations
    let conversations;
    if (existsSync(JSONL_PATH)) {
        console.log('  Loading from local JSONL file...');
        conversations = loadFromJsonl(JSONL_PATH);
    } else {
        console.log('  Attempting HuggingFace API download...');
        conversations = await fetchFromHF();
    }

    if (!conversations || conversations.length === 0) {
        console.error('  ERROR: No conversations loaded.');
        console.error('  To use rp-opus eval:');
        console.error('    1. Accept terms at https://huggingface.co/datasets/taozi555/rp-opus');
        console.error('    2. Set HF_TOKEN in .env');
        console.error('    3. Or manually download messages_remaining.jsonl to eval/data/');
        process.exit(1);
    }

    // Build episodes for each conversation
    for (const conv of conversations) {
        conv.episodes = buildEpisodesFromMessages(conv.messages);
        console.log(`  ${conv.characterName}: ${conv.messages.length} msgs → ${conv.episodes.length} episodes`);
    }

    // Generate synthetic probes if LLM available
    if (llmCallFn) {
        for (const conv of conversations) {
            conv.probes = await generateProbes(conv, maxProbes, llmCallFn);
            console.log(`  ${conv.characterName}: ${conv.probes.length} probes generated`);
        }
    }

    const result = { conversations };
    writeFileSync(CACHE_PATH, JSON.stringify(result), 'utf-8');
    console.log(`  Cached to ${CACHE_PATH}`);
    return result;
}

function loadFromJsonl(path) {
    const content = readFileSync(path, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const candidates = [];

    for (const line of lines) {
        try {
            const row = JSON.parse(line);
            if (row.lang_code !== 'en') continue;
            const msgs = (row.messages || []).filter(m => m.role !== 'system');
            if (msgs.length < MIN_MESSAGES) continue;
            candidates.push({
                chatId: row.chat_id,
                characterName: row.robot?.robot_name || 'Character',
                systemPrompt: (row.messages || []).find(m => m.role === 'system')?.content || '',
                rawMessages: msgs,
                messageCount: msgs.length,
            });
        } catch { continue; }
    }

    candidates.sort((a, b) => b.messageCount - a.messageCount);
    return candidates.slice(0, TARGET_CONVERSATIONS).map(convertConversation);
}

async function fetchFromHF() {
    const token = process.env.HF_TOKEN;
    if (!token) return null;

    try {
        // Try rows API with auth
        const url = 'https://datasets-server.huggingface.co/rows?dataset=taozi555/rp-opus&config=default&split=train&offset=0&length=200';
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) return null;

        const data = await response.json();
        if (!data.rows?.length) return null;

        const candidates = [];
        for (const { row } of data.rows) {
            if (row.lang_code !== 'en') continue;
            const msgs = (row.messages || []).filter(m => m.role !== 'system');
            if (msgs.length < MIN_MESSAGES) continue;
            candidates.push({
                chatId: row.chat_id,
                characterName: row.robot?.robot_name || 'Character',
                systemPrompt: (row.messages || []).find(m => m.role === 'system')?.content || '',
                rawMessages: msgs,
                messageCount: msgs.length,
            });
        }

        candidates.sort((a, b) => b.messageCount - a.messageCount);
        return candidates.slice(0, TARGET_CONVERSATIONS).map(convertConversation);
    } catch {
        return null;
    }
}

function convertConversation(candidate) {
    const messages = candidate.rawMessages.map((msg, idx) => ({
        id: idx,
        isUser: msg.role === 'user',
        name: msg.role === 'user' ? 'User' : candidate.characterName,
        text: String(msg.content || '').trim(),
    }));

    return {
        chatId: candidate.chatId,
        characterName: candidate.characterName,
        systemPrompt: candidate.systemPrompt,
        messages,
        episodes: [],
        probes: [],
    };
}

function buildEpisodesFromMessages(messages) {
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

        const candidate = buildEpisodeCandidate({
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

async function generateProbes(conv, maxProbes, llmCallFn) {
    const { messages } = conv;
    const probes = [];
    const windowSize = 10;

    // Pick evenly spaced positions: 10%, 30%, 50%, 70%, 90%
    const positions = [0.1, 0.3, 0.5, 0.7, 0.9];

    for (const pos of positions) {
        if (probes.length >= maxProbes) break;

        const center = Math.floor(messages.length * pos);
        const start = Math.max(0, center - Math.floor(windowSize / 2));
        const end = Math.min(messages.length - 1, start + windowSize - 1);
        const window = messages.slice(start, end + 1);

        // Skip if too little content
        const totalContent = window.map(m => m.text).join(' ');
        if (totalContent.length < 200) continue;

        const excerpt = window.map(m => `${m.name}: ${m.text.slice(0, 300)}`).join('\n');

        const result = await llmCallFn({
            prompt: `Given this roleplay conversation excerpt (messages ${start}-${end}), create one memory probe question.
The question should test whether a memory system can recall a specific detail, event, or character action from this section.
The question should be answerable ONLY from this excerpt, not from general knowledge.

Return JSON: {"question": "...", "answer": "...", "category": "detail|event|character|relationship|location"}
Return ONLY the JSON.

Conversation:
${excerpt}`,
            systemPrompt: 'You create precise memory test questions for roleplay conversations. Return only JSON.',
            maxTokens: 200,
        });

        if (!result?.text) continue;

        try {
            const match = result.text.match(/\{[\s\S]*\}/);
            if (!match) continue;
            const parsed = JSON.parse(match[0]);
            if (parsed.question && parsed.answer) {
                probes.push({
                    question: parsed.question,
                    answer: parsed.answer,
                    category: parsed.category || 'detail',
                    sourceRange: [start, end],
                });
            }
        } catch { continue; }
    }

    return probes;
}
