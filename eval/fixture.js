// Single RP chat fixture for benchmarking Anchor Memory extraction, episode creation, and retrieval.
// Messages are crafted to trigger the regex patterns in writing/extract-state.js.

function msg(id, isUser, name, text) {
    return { id, isUser, name, text };
}

// --- Scene 1: The Rusty Anchor tavern (msgs 0-9) ---
// Triggers: location "inside The Rusty Anchor", goal "need to find the missing map"
export const CHAT_MESSAGES = [
    msg(0, true, 'User', 'I push open the heavy wooden door and step inside The Rusty Anchor tavern. The air is thick with smoke and the smell of ale.'),
    msg(1, false, 'Elena', 'Elena looks up from behind the bar, her dark eyes narrowing. "You must be the one they sent. Come, sit down."'),
    msg(2, true, 'User', 'I take a seat at the bar. "I heard you have information about the old cartographer\'s work."'),
    msg(3, false, 'Elena', '"The map he made before he disappeared — it shows the path to the Sunken Vault. But someone stole it from the archives last week."'),
    msg(4, true, 'User', '"Then we need to find the missing map before anyone else does. Do you have any leads?"'),
    msg(5, false, 'Elena', 'She leans closer. "I saw a hooded figure near the cellar two nights ago. They were carrying something rolled up — could have been a scroll or map."'),
    msg(6, true, 'User', '"A hooded figure? Did you get a look at their face?"'),
    msg(7, false, 'Elena', '"No. But they went down into the cellar and I heard strange noises. I haven\'t gone down there since."'),
    msg(8, true, 'User', '"We should check the cellar then. Lead the way."'),
    msg(9, false, 'Elena', 'Elena grabs a lantern from behind the bar. "Follow me. And stay close — the cellar at The Rusty Anchor has a reputation."'),

    // --- Scene 2: The cellar (msgs 10-19) ---
    // Triggers: location "in the cellar", conflict "fighting the rats"
    msg(10, true, 'User', 'We descend the creaking stairs and find ourselves in the cellar. It smells of damp stone and old wine.'),
    msg(11, false, 'Elena', 'Elena raises her lantern. "Over there — do you see those scratch marks on the wall? Something has been digging."'),
    msg(12, true, 'User', 'I draw my sword and approach the scratched wall. "These marks are fresh."'),
    msg(13, false, 'Elena', 'A screech echoes through the cellar as a swarm of giant rats bursts from behind the barrels.'),
    msg(14, true, 'User', 'I swing my blade and start fighting the rats that pour out from every corner. "Elena, get behind me!"'),
    msg(15, false, 'Elena', 'Elena grabs a broken bottle and joins the fight. After a fierce struggle, the last rat falls. "Look — behind the barrels. There\'s a door."'),
    msg(16, true, 'User', 'I shove the barrels aside to reveal a hidden stone door with ancient runes carved into its surface.'),
    msg(17, false, 'Elena', '"I\'ve never seen this before. These runes... they\'re old. Very old. Someone has been here recently though — the dust is disturbed."'),
    msg(18, true, 'User', '"Only one way to find out what\'s behind it." I push the stone door open.'),
    msg(19, false, 'Elena', 'The door grinds open, revealing a dark passage that descends deeper underground. A cold draft rushes out. "After you," Elena whispers.'),

    // --- Scene 3: Underground tunnels + betrayal (msgs 20-29) ---
    // Triggers: location "in the underground tunnels", time "night", significance 5 "betrayed"
    // msg 25 is the NOISE TEST: past reference to "The Rusty Anchor" that should NOT override location
    msg(20, true, 'User', 'We step through the doorway and find ourselves in the underground tunnels. The walls are lined with glowing crystals.'),
    msg(21, false, 'Elena', 'The tunnels stretch in both directions. Elena points left. "I can feel a draft from that direction — it might lead outside."'),
    msg(22, true, 'User', '"Let\'s follow the draft. Keep your eyes open for traps." I take the lead, sword at the ready.'),
    msg(23, false, 'Elena', 'They walk for what feels like hours. Through a crack in the ceiling, they can see the stars. It is night now.'),
    msg(24, true, 'User', '"It\'s getting late. We should find a safe spot to rest. Who knows what else lurks down here?"'),
    msg(25, false, 'Elena', 'Elena stops and turns in the underground tunnels. "I remember the bartender mentioned a vault. But that doesn\'t matter now." Her hand moves to a hidden dagger.'),
    msg(26, true, 'User', '"Elena, what are you doing? Put that dagger away."'),
    msg(27, false, 'Elena', '"I\'m sorry. But you were never meant to reach the vault." Elena betrayed everything — she lunges with the dagger, her eyes cold.'),
    msg(28, true, 'User', 'I barely dodge the strike. "You betrayed me! Who sent you? Who sent Elena to stop me?"'),
    msg(29, false, 'Elena', 'She snarls as I disarm her. "You\'ll never know. The Order will send others." She bolts into the darkness of the tunnels.'),

    // --- Scene 4: Escape to forest (msgs 30-39) ---
    // Triggers: location "in the forest", goal "need to reach the citadel", open thread "who sent Elena"
    msg(30, true, 'User', 'I chase after her but she vanishes into the maze of tunnels. Wounded and alone, I press on toward the draft.'),
    msg(31, false, 'Elena', 'The tunnel opens into a moonlit clearing. The user stumbles out into the forest, breathing heavily.'),
    msg(32, true, 'User', 'I collapse against a tree in the forest. My arm is bleeding from Elena\'s dagger. "Damn her."'),
    msg(33, false, 'Elena', 'The forest is quiet except for distant owl calls. The stars are bright overhead and the tunnel entrance is barely visible behind thick brambles.'),
    msg(34, true, 'User', 'I bandage my wound and try to get my bearings. The citadel should be to the north. "I need to reach the citadel before dawn."'),
    msg(35, false, 'Elena', 'A distant bell tolls from the direction of the citadel. Someone knows he\'s coming.'),
    msg(36, true, 'User', '"If the Order is real, they\'ll have people at the citadel too. But I still don\'t know who sent Elena. Why did she betray us?"'),
    msg(37, false, 'Elena', 'The wind carries the faint sound of hoofbeats. Riders are approaching from the east.'),
    msg(38, true, 'User', '"I need to reach the citadel before those riders find me." I start moving north through the trees.'),
    msg(39, false, 'Elena', 'Still deep in the forest, the user pushes north. The citadel\'s towers gleam ahead in the moonlight.'),
];

// Ground truth checkpoints: what extraction should return at each point
export const CHECKPOINTS = [
    {
        label: 'Scene 1: Tavern arrival',
        afterMessageId: 9,
        expected: {
            location: 'The Rusty Anchor',
            timeContext: '',
            activeGoal: 'find the missing map',
            activeConflict: '',
            participants: ['User', 'Elena'],
            openThreads: [],
        },
    },
    {
        label: 'Scene 2: Cellar combat',
        afterMessageId: 19,
        expected: {
            location: 'the cellar',
            timeContext: '',
            activeGoal: '',
            activeConflict: 'fighting',
            participants: ['User', 'Elena'],
            openThreads: [],
        },
    },
    {
        label: 'Scene 3: Tunnels + betrayal',
        afterMessageId: 29,
        expected: {
            location: 'underground tunnels',
            timeContext: 'night',
            activeGoal: '',
            activeConflict: '',
            participants: ['User', 'Elena'],
            openThreads: ['who sent Elena'],
        },
    },
    {
        label: 'Scene 4: Forest escape',
        afterMessageId: 39,
        expected: {
            location: 'the forest',
            timeContext: '',
            activeGoal: 'reach the citadel',
            activeConflict: '',
            participants: ['User', 'Elena'],
            openThreads: ['Elena'],
        },
    },
];

// Episode creation ground truth
export const EPISODE_EXPECTATIONS = [
    {
        label: 'First auto-episode (tavern+cellar)',
        triggerAfterMessageId: 14,
        threshold: 14,
        expect: {
            titleContains: null,
            locationIncludes: null,
            minSignificance: 2,
            created: true,
        },
    },
    {
        label: 'Betrayal episode (forced)',
        triggerAfterMessageId: 29,
        force: true,
        threshold: 1,
        expect: {
            titleContains: null,
            locationIncludes: null,
            minSignificance: 4,
            created: true,
        },
    },
];

// Retrieval ranking queries
export const RETRIEVAL_QUERIES = [
    {
        label: 'Betrayal query',
        queryText: 'Elena betrayal dagger',
        expectedTopContains: 'betray',
    },
    {
        label: 'Tavern query',
        queryText: 'The Rusty Anchor tavern',
        expectedTopContains: 'Rusty Anchor',
    },
    {
        label: 'Cellar query',
        queryText: 'rats cellar fighting',
        expectedTopContains: 'cellar',
    },
];

// Windowed vs flat comparison: windowed should match or beat flat on all checkpoints
// The key value is on long chats where windows prevent late false positives from dominating
export const NOISE_TEST = {
    checkpointIndex: 2,
    correctLocation: 'underground tunnels',
};
