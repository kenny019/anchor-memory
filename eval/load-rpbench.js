import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSceneCard, mergeSceneCard } from '../models/state-cards.js';
import { extractStateUpdates } from '../writing/extract-state.js';
import { buildEpisodeCandidate } from '../writing/build-episode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, 'data', 'rpbench.json');

const HF_DATASET = 'MiniMaxAI/role-play-bench';
const SEEDS_CONFIG = 'seeds_en';
const DIALOGUES_CONFIG = 'dialogues_en';
const TARGET_CONVERSATIONS = 8;
const MIN_TURNS = 40;

export async function loadRpBenchData({ maxProbes = 5, llmCallFn = null } = {}) {
    // Return cached if probes present
    if (existsSync(CACHE_PATH)) {
        const cached = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
        if (cached.conversations?.length > 0 && cached.conversations[0].probes?.length > 0) {
            console.log(`  Loaded cached rpbench data: ${cached.conversations.length} conversations`);
            return cached;
        }
    }

    // Fetch seeds
    console.log('  Fetching rpbench seeds...');
    const seeds = await fetchSeeds();
    if (!seeds || seeds.length === 0) {
        console.error('  ERROR: Failed to fetch rpbench seeds');
        process.exit(1);
    }
    console.log(`  Fetched ${seeds.length} seeds`);

    // Fetch dialogues
    console.log('  Fetching rpbench dialogues...');
    const dialogues = await fetchDialogues();
    if (!dialogues || dialogues.length === 0) {
        console.error('  ERROR: Failed to fetch rpbench dialogues');
        process.exit(1);
    }
    console.log(`  Fetched ${dialogues.length} dialogues`);

    // Filter to run_1 only
    const run1 = dialogues.filter(d => d.run_id === 'run_1');
    console.log(`  run_1 dialogues: ${run1.length}`);

    // Auto-detect best model: most conversations with num_turns >= MIN_TURNS
    const modelCounts = {};
    for (const d of run1) {
        if (d.num_turns >= MIN_TURNS) {
            modelCounts[d.model_name] = (modelCounts[d.model_name] || 0) + 1;
        }
    }
    const bestModel = Object.entries(modelCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0];

    if (!bestModel) {
        console.error('  ERROR: No model found with sufficient long conversations');
        process.exit(1);
    }
    console.log(`  Auto-detected model: ${bestModel} (${modelCounts[bestModel]} convs >= ${MIN_TURNS} turns)`);

    // Select top conversations by num_turns
    const modelDialogues = run1
        .filter(d => d.model_name === bestModel)
        .sort((a, b) => b.num_turns - a.num_turns)
        .slice(0, TARGET_CONVERSATIONS);

    // Build seed lookup
    const seedMap = new Map(seeds.map(s => [s.id, s]));

    // Convert to internal format
    const conversations = modelDialogues.map(d => {
        const seed = seedMap.get(d.seed_id) || {};
        const userName = seed.user_name || 'User';
        const aiName = seed.ai_name || 'Character';
        const systemPrompt = [seed.ai_setting, seed.ai_prologue].filter(Boolean).join('\n\n');

        const rawDialogue = typeof d.dialogue === 'string' ? JSON.parse(d.dialogue) : (d.dialogue || []);
        const messages = rawDialogue.map((msg, idx) => ({
            id: idx,
            isUser: msg.role === 'user',
            name: msg.role === 'user' ? userName : aiName,
            text: String(msg.text || '').trim(),
        }));

        return {
            chatId: `rpbench_${d.seed_id}_${bestModel}_run_1`,
            characterName: aiName,
            systemPrompt,
            messages,
            episodes: [],
            probes: [],
        };
    });

    console.log(`  Selected ${conversations.length} conversations`);

    // Build heuristic episodes
    for (const conv of conversations) {
        conv.episodes = await buildEpisodesFromMessages(conv.messages);
        console.log(`  ${conv.characterName}: ${conv.messages.length} msgs → ${conv.episodes.length} episodes`);
    }

    // Generate probes via LLM
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

async function fetchSeeds() {
    try {
        const url = `https://datasets-server.huggingface.co/rows?dataset=${HF_DATASET}&config=${SEEDS_CONFIG}&split=test&offset=0&length=100`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        return (data.rows || []).map(r => r.row);
    } catch {
        return null;
    }
}

async function fetchDialogues() {
    const allRows = [];
    let offset = 0;
    const pageSize = 100;

    try {
        while (true) {
            const url = `https://datasets-server.huggingface.co/rows?dataset=${HF_DATASET}&config=${DIALOGUES_CONFIG}&split=test&offset=${offset}&length=${pageSize}`;
            const response = await fetch(url);
            if (!response.ok) break;
            const data = await response.json();
            const rows = (data.rows || []).map(r => r.row);
            if (rows.length === 0) break;
            allRows.push(...rows);
            if (rows.length < pageSize) break;
            offset += pageSize;
        }
    } catch {
        // Return what we have
    }

    return allRows;
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

async function generateProbes(conv, maxProbes, llmCallFn) {
    const { messages } = conv;
    const probes = [];
    const windowSize = 10;

    const positions = [0.1, 0.3, 0.5, 0.7, 0.9];

    for (const pos of positions) {
        if (probes.length >= maxProbes) break;

        const center = Math.floor(messages.length * pos);
        const start = Math.max(0, center - Math.floor(windowSize / 2));
        const end = Math.min(messages.length - 1, start + windowSize - 1);
        const window = messages.slice(start, end + 1);

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
