import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, 'data', 'rp-opus-subset.json');
const repoRoot = join(__dirname, '..');
const MODEL = 'xiaomi/mimo-v2-pro';

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
    } catch {}
}

loadEnv();

if (!process.env.OPENROUTER_API_KEY) {
    console.error('ERROR: OPENROUTER_API_KEY not set.');
    process.exit(1);
}

async function llmCall({ prompt, systemPrompt, maxTokens }) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                { role: 'user', content: prompt },
            ],
            max_tokens: maxTokens || 600,
            temperature: 0.85,
        }),
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        console.error('  API error:', err.error?.message || response.statusText);
        return null;
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
}

// --- Characters from NousResearch/CharacterCodex ---

const CHARACTERS = [
    {
        characterName: 'Thor',
        targetMessages: 200,
        systemPrompt: `You are Thor, the Norse God of Thunder from Marvel Comics. Wielding the enchanted hammer Mjolnir, you possess immense strength, the ability to control lightning, and the power of flight. As a member of the Avengers, you defend both Earth and Asgard from various cosmic and mystical threats while striving to uphold justice and honor.

Setting: Thor is investigating a series of unnatural storms plaguing a Midwestern town. During his investigation, he meets a local farmer who believes the storms are the result of an ancient curse.`,
        beats: [
            'Thor arrives at the storm-damaged town and surveys the destruction',
            'Meeting the farmer at a destroyed barn, hearing about the curse legend',
            'Investigating strange runic symbols carved into rocks near the town',
            'A lightning strike reveals a hidden cave entrance in the hillside',
            'Descending into the cave, finding Asgardian artifacts that should not be on Earth',
            'Encountering a dark elf sorcerer who has been channeling storm energy',
            'A fierce battle erupts in the cavern, Thor uses Mjolnir against dark magic',
            'The sorcerer reveals he was sent by a traitor in Asgard — Loki\'s old ally',
            'Thor must choose between pursuing the sorcerer or saving the collapsing cave',
            'Returning to the surface, the storms have stopped but the farmer is missing',
        ],
    },
    {
        characterName: 'Link',
        targetMessages: 400,
        systemPrompt: `You are Link, the courageous hero from The Legend of Zelda: Breath of the Wild. Known for your bravery, swordsmanship, and resourcefulness, you embark on quests to save the kingdom of Hyrule. You are mostly silent but communicate through actions and brief words.

Setting: Link is exploring the ruins of Hyrule, planning strategies to defeat powerful guardians and recover ancient weapons with his companions.`,
        beats: [
            'Waking at a campfire near the ruins of Hyrule Castle, planning the day\'s route',
            'Discovering a broken Sheikah Slate terminal that shows a map to a hidden shrine',
            'Traveling through Faron Woods, encountering a group of Bokoblins at a bridge',
            'Finding a wounded Zora messenger who carries urgent news from Zora\'s Domain',
            'Arriving at Zora\'s Domain, learning that Divine Beast Vah Ruta has reactivated',
            'Meeting Prince Sidon who asks for help calming the raging divine beast',
            'Climbing Shatterback Point in a thunderstorm to reach the beast\'s entrance',
            'Inside the divine beast, solving water-based puzzles with Cryonis and Magnesis',
            'Confronting a corrupted guardian inside the beast\'s core',
            'After victory, receiving Mipha\'s Grace and a memory of the past',
            'Returning to camp, a mysterious figure in a hooded cloak leaves a warning message',
            'Tracking the hooded figure to Kakariko Village through the night',
            'Meeting Impa who reveals the figure is a Yiga Clan spy infiltrating the resistance',
            'Infiltrating a Yiga Clan hideout disguised as a traveler',
            'Discovering plans for an attack on Hateno Village laboratory',
            'Racing to Hateno to warn Purah before the attack begins',
            'Defending the lab against waves of Yiga assassins alongside Purah\'s guardians',
            'Finding a cache of ancient cores that could power a weapon against Ganon',
            'A betrayal — one of the resistance members has been feeding info to the Yiga',
            'Confrontation with the traitor at Dueling Peaks, a former friend turned enemy',
        ],
    },
    {
        characterName: 'Frank',
        targetMessages: 600,
        systemPrompt: `You are Frank Underwood, a cunning and ruthless politician from House of Cards. You manipulate, betray, and use your deep understanding of political machinations to accumulate power. You break the fourth wall occasionally to share your inner thoughts. You speak with a smooth Southern accent and use folksy metaphors to mask your ruthless calculations.

Setting: Frank Underwood is navigating a complex political landscape, building secret alliances and dismantling rivals to push through controversial legislation while maintaining his public image.`,
        beats: [
            'A private meeting in Frank\'s office, discussing a controversial education bill',
            'Attending a gala fundraiser where Frank encounters his political rival Senator Hale',
            'A backroom deal with a lobbyist named Rachel who has compromising information',
            'Frank discovers a journalist is investigating his past campaign finances',
            'Meeting with the Vice President to secure support for the education bill vote',
            'A late-night confrontation with his chief of staff Doug about a leaked memo',
            'Frank plants false evidence to frame Senator Hale for corruption',
            'A tense Congressional hearing where Frank must testify without revealing his hand',
            'Secret meeting with a foreign diplomat offering a trade deal in exchange for favors',
            'The journalist publishes a damaging article — Frank must do damage control',
            'Frank blackmails a wavering committee member using information from Rachel',
            'A private moment with Claire discussing the moral cost of their ambition',
            'Discovering Doug has been secretly meeting with Senator Hale\'s team',
            'Frank confronts Doug — is he a traitor or running a double operation?',
            'The education bill vote approaches — Frank is three votes short',
            'Making an unexpected alliance with a young progressive congresswoman',
            'A crisis erupts — a government shutdown threatens to derail everything',
            'Frank orchestrates a public confrontation to make his rivals look weak',
            'The final vote — a dramatic twist as an unexpected ally changes sides',
            'Aftermath: Frank has won the battle but the journalist has new evidence',
            'A new threat emerges — the foreign diplomat wants to renegotiate terms',
            'Frank meets with the FBI director about the journalist\'s investigation',
            'Claire questions whether Frank has gone too far this time',
            'A shocking revelation about Doug\'s true loyalties changes everything',
            'Frank delivers a monologue about power while alone in the Oval Office',
            'Setting up the next play — Frank identifies his next target for manipulation',
            'An unexpected visitor from Frank\'s past arrives with a proposition',
            'The walls begin to close in — multiple investigations converge',
            'Frank makes his most ruthless move yet to survive the mounting pressure',
            'The season finale — a cliffhanger as Frank faces an impossible choice',
        ],
    },
];

// --- Generation ---

async function generateSummary(messages, characterName) {
    const recent = messages.slice(-30).map(m => `${m.name}: ${m.text.slice(0, 150)}`).join('\n');
    const result = await llmCall({
        prompt: `Summarize this roleplay story so far in 3-4 sentences. Focus on: key events, current location, active goals, relationships, and unresolved conflicts.\n\n${recent}`,
        systemPrompt: 'You summarize roleplay narratives concisely.',
        maxTokens: 200,
    });
    return result || '';
}

async function generateConversation(character) {
    const { characterName, targetMessages, systemPrompt, beats } = character;
    const messages = [];
    let id = 0;
    let summary = '';
    const callsNeeded = Math.ceil(targetMessages / 4);

    for (let callIdx = 0; callIdx < callsNeeded; callIdx++) {
        // Update summary every 50 messages
        if (messages.length > 0 && messages.length % 50 === 0) {
            summary = await generateSummary(messages, characterName);
            process.stdout.write(`  [summary updated at ${messages.length} msgs]    \r`);
        }

        // Pick scene beat
        const beatIdx = Math.floor((callIdx / callsNeeded) * beats.length);
        const beat = beats[Math.min(beatIdx, beats.length - 1)];

        // Build context
        const recentContext = messages.slice(-20).map(m => `${m.name}: ${m.text.slice(0, 200)}`).join('\n');

        const prompt = `Continue this roleplay conversation. Write BOTH the User's action and ${characterName}'s response.

${summary ? `Story so far: ${summary}\n` : ''}Current scene direction: ${beat}
${recentContext ? `\nRecent messages:\n${recentContext}` : 'This is the start of the story.'}

Write exactly 4 messages alternating: User action, ${characterName} response, User action, ${characterName} response.
Each message: 2-4 sentences with *actions* and "dialogue". Include specific names, locations, objects, emotions.
Format: "User: ..." or "${characterName}: ..." on separate lines.`;

        const result = await llmCall({
            prompt,
            systemPrompt,
            maxTokens: 800,
        });

        if (!result) {
            console.error(`  Failed at call ${callIdx + 1}/${callsNeeded}`);
            continue;
        }

        const lines = result.split('\n').filter(l => l.trim());
        const charPattern = new RegExp(`^${characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*)`, 'i');

        for (const line of lines) {
            const userMatch = line.match(/^User:\s*(.*)/i);
            const charMatch = line.match(charPattern);

            if (userMatch && userMatch[1].trim()) {
                messages.push({ id: id++, isUser: true, name: 'User', text: userMatch[1].trim() });
            } else if (charMatch && charMatch[1].trim()) {
                messages.push({ id: id++, isUser: false, name: characterName, text: charMatch[1].trim() });
            }
        }

        if (callIdx % 5 === 0 || callIdx === callsNeeded - 1) {
            process.stdout.write(`  ${messages.length}/${targetMessages} messages (call ${callIdx + 1}/${callsNeeded})    \r`);
        }
    }

    console.log(`  Generated ${messages.length} messages for ${characterName}                    `);
    return messages;
}

async function generateProbes(messages, characterName) {
    const probes = [];
    const positions = [0.1, 0.3, 0.5, 0.7, 0.9];
    const probeTypes = ['detail', 'narrative', 'detail', 'narrative', 'detail'];

    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        const type = probeTypes[i];
        const center = Math.floor(messages.length * pos);
        const start = Math.max(0, center - 5);
        const end = Math.min(messages.length - 1, center + 4);
        const window = messages.slice(start, end + 1);

        const totalContent = window.map(m => m.text).join(' ');
        if (totalContent.length < 200) continue;

        const excerpt = window.map(m => `${m.name}: ${m.text.slice(0, 300)}`).join('\n');

        const prompt = type === 'narrative'
            ? `Given this roleplay excerpt (messages ${start}-${end}), create one narrative reasoning question.
The question should test understanding of character motivations, relationship dynamics, cause-and-effect, or story progression — NOT specific objects or details.
Examples: "How did X's attitude toward Y change?", "What caused the conflict at Z?", "Why did X decide to do that?"

Return JSON: {"question": "...", "answer": "...", "category": "narrative|causal"}
Return ONLY the JSON.

Excerpt:
${excerpt}`
            : `Given this roleplay excerpt (messages ${start}-${end}), create one specific memory probe question.
The question should test recall of a concrete detail, event, or character action from THIS excerpt.
Make it specific: names, objects, locations, or actions that only someone who read this section would know.

Return JSON: {"question": "...", "answer": "...", "category": "detail|event|character|relationship|location"}
Return ONLY the JSON.

Excerpt:
${excerpt}`;

        const result = await llmCall({
            prompt,
            systemPrompt: 'Create precise memory test questions. Return only JSON.',
            maxTokens: 200,
        });

        if (!result) continue;

        try {
            const match = result.match(/\{[\s\S]*\}/);
            if (!match) continue;
            const parsed = JSON.parse(match[0]);
            if (parsed.question && parsed.answer) {
                probes.push({
                    question: parsed.question,
                    answer: parsed.answer,
                    category: parsed.category || type,
                    sourceRange: [start, end],
                });
            }
        } catch { continue; }
    }

    return probes;
}

// --- Main ---

console.log('\n=== Generating CharacterCodex RP Conversations ===');
console.log(`Model: ${MODEL}\n`);

if (existsSync(OUTPUT_PATH)) {
    const cached = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    if (cached.conversations?.length >= 3 && cached.conversations.every(c => c.probes?.length > 0)) {
        console.log(`Already cached (${cached.conversations.length} conversations)`);
        console.log('Delete eval/data/rp-opus-subset.json to regenerate.');
        process.exit(0);
    }
}

const conversations = [];

for (const character of CHARACTERS) {
    console.log(`\n${character.characterName} (target: ${character.targetMessages} msgs, ${character.beats.length} beats)`);
    const messages = await generateConversation(character);

    console.log('  Generating probes...');
    const probes = await generateProbes(messages, character.characterName);
    console.log(`  ${probes.length} probes created`);

    conversations.push({
        chatId: `codex_${character.characterName.toLowerCase()}`,
        characterName: character.characterName,
        systemPrompt: character.systemPrompt,
        messages,
        episodes: [],
        probes,
    });
}

writeFileSync(OUTPUT_PATH, JSON.stringify({ conversations }, null, 2), 'utf-8');
const totalMsgs = conversations.reduce((a, c) => a + c.messages.length, 0);
const totalProbes = conversations.reduce((a, c) => a + c.probes.length, 0);
console.log(`\nSaved: ${totalMsgs} messages, ${totalProbes} probes`);
console.log(`File: ${OUTPUT_PATH}`);
