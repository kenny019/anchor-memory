# Anchor Memory

**Install it. Forget about it. Your AI remembers what matters.**

Anchor Memory is a [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that gives your AI persistent memory across long roleplay sessions. It tracks where you are, what's happening, and what happened before — then quietly injects the right context before every generation.

- **Tracks your scene** — location, time, goals, conflicts, participants, open plot threads
- **Remembers past events** — automatically creates episode summaries as your story progresses
- **Never truly forgets** — old memories are archived and searchable, not deleted
- **Retrieves what matters** — scores and selects the most relevant memories for each generation

No commands to learn. No lorebooks to maintain. Just install and roleplay.

## Install

1. Open SillyTavern, go to **Extensions** > **Install Extension**
2. Paste this URL:
   ```
   https://github.com/kenny019/anchor-memory
   ```
3. Click **Install**. Done.

Anchor Memory starts working immediately with zero configuration. It uses no API calls in its default mode — everything runs locally with deterministic scoring.

## How It Works

Every time the AI generates a response, Anchor Memory:

1. **Extracts the current scene** — location, who's present, what's happening, unresolved threads
2. **Detects episode boundaries** — scene changes, significant events, dramatic beats
3. **Scores past episodes** against the current context to find relevant memories
4. **Injects a memory block** into the prompt so the AI knows what happened before

The memory block looks like this (XML mode, recommended):
```xml
<anchor_memory>
<scene>
<location>Great Tomb of Nazarick, throne room</location>
<goal>Investigate the effects of Void Refinement power</goal>
<conflict>Ley Lin's power produces unexpected results</conflict>
<participants>Ley Lin, Ainz Ooal Gown</participants>
<open_threads>What is causing the ceiling gap to extend through six floors | How much of Ley Lin's power can Ainz interpret</open_threads>
</scene>
<events>
<event significance="3" tags="lore, foreshadowing">
<title>Ainz and Ley Lin map an ancient concentric formation</title>
<summary>Ley Lin interprets the corridor geometry as an ancient immortal art formation. Ainz examines the concept while Ley Lin reveals hoarded jade talismans.</summary>
<key_facts>Ley Lin interprets corridor as immortal art formation; Ley Lin has hoarded jade talismans; Ainz reacts with collector-like stillness</key_facts>
</event>
</events>
</anchor_memory>
```

## Features

### Free (no API calls)

Works out of the box with zero cost:

- Heuristic scene state tracking (location, time, goals, conflicts, participants, threads)
- Keyword + significance-based episode retrieval
- Budget-aware injection that scales with conversation length
- Episode auto-creation every ~14 messages

### Enhanced (cheap LLM — recommended)

Point Anchor Memory at a cheap nano model for dramatically better memory. Set **Model source** and **Model ID** in settings — all LLM features auto-enable.

| Feature | Free (heuristic) | Enhanced (LLM) |
|---|---|---|
| Scene extraction | Regex patterns — often captures narrative fragments as locations | LLM understands context — "Nazarick throne room" not "the lotus position" |
| Open threads | Raw dialogue quotes that pile up | Coherent narrative questions, replaced each turn |
| Episode boundaries | Fixed every 14 messages | Detects scene changes, betrayals, dramatic beats |
| Episode summaries | Last 4 messages truncated | Structured: title, summary, tags, significance, key facts |
| Retrieval | Keyword scoring | RLM + deep retrieval (reads actual messages to verify) |
| Consolidation | N/A | Multi-level: events → arcs → themes → meta-narratives |
| Archived search | N/A | Old memories searchable via recall tool |

Cost: **~$0.13 per 500-turn session** on `openai/gpt-5.4-nano` via OpenRouter. Actual cost varies with model pricing and message length.

### Setup (Enhanced)

1. Have a working API connection in SillyTavern (e.g. OpenRouter with API key)
2. In Anchor Memory settings, set **Model source** to match your ST connection (e.g. `openrouter`)
3. Set **Model ID** to a cheap model (e.g. `openai/gpt-5.4-nano`)

Memory calls go through ST's existing API connection — same key, no separate config needed.

## Benchmark Results

### RPBench (8 conversations, 40 probes)

Early results on a small sample. Tested on [MiniMaxAI/role-play-bench](https://huggingface.co/datasets/MiniMaxAI/role-play-bench) conversations with auto-generated probes.

| Configuration | Span Overlap | Answer Containment |
|---|---|---|
| Heuristic + Keyword (free) | 67.5% | 71.7% |
| Heuristic + LLM Hybrid | 82.5% | 78.9% |
| LLM Episodes + Keyword | 82.5% | 80.4% |
| **LLM Episodes + Hybrid** | **90.0%** | **86.8%** |

On reachable probes (excluding probes where the answer span fell outside the episode window): 97.3% accuracy with LLM+Hybrid. Sample size is small — treat these as directional, not definitive.

## Settings

### Core

| Setting | Default | What it does |
|---|---|---|
| **Enable** | On | Master toggle |
| **Preserve recent messages** | 12 | How many recent messages to analyze for context |
| **Max episodes** | 3 | Maximum episodes injected per generation |
| **Prompt position** | In Chat | Where the memory block appears |
| **Prompt depth** | 1 | How deep in the chat the injection sits |
| **Memory format** | Plain Text | Plain Text or XML |

### Enhanced Memory (LLM)

| Setting | Default | What it does |
|---|---|---|
| **Model source** | (empty) | API provider (e.g. `openrouter`) |
| **Model ID** | (empty) | Model to use (e.g. `openai/gpt-5.4-nano`) |

When both are set, all LLM features auto-enable: scene extraction, boundary detection, episode summaries, retrieval, and consolidation.

### Consolidation (Advanced)

These are inside the **Advanced** dropdown. Defaults work well — only change them if you know what you're doing.

| Setting | Default | What it does |
|---|---|---|
| **Max consolidation depth** | 3 | How many levels deep memories can be merged (1 = events→arcs only, 3 = events→arcs→themes→meta) |
| **Min cluster size** | 4 | How many similar episodes are needed before they get merged together |
| **Archived search** | On | Whether the recall_memory tool can search through old archived episodes |
| **Archived score penalty** | 0.5 | How much to down-rank archived results (0.5 = they need to be twice as relevant to rank equally) |
| **Max archived results** | 2 | How many archived episodes can appear in a recall search |

## Commands

Optional — Anchor Memory works without them. Output appears in a dialog popup.

| Command | What it does |
|---|---|
| `/am-status` | Show current memory state (scene card, episode count, boundary) |
| `/am-retrieve` | Preview the memory block that would be injected |
| `/am-scene [title]` | Force-commit current scene into an episode |
| `/am-consolidate` | Consolidate episodes across all depth levels (full multi-depth cascade) |
| `/am-reset` | Clear all Anchor Memory data for the current chat |

You can also inspect state in the browser console:
```javascript
await window.AnchorMemory.getChatState()
```

## Comparison with Other Extensions

There are many memory extensions for SillyTavern. Here's how they differ:

### Quick Summary

- **Built-in Summarize** — One rolling summary that gets rewritten each time. Simple but lossy — details disappear over time.
- **Built-in Vectorization** — Stores every message as a vector embedding, retrieves by similarity. No narrative understanding.
- **[ST-Memory-Enhancement](https://github.com/muyoou/st-memory-enhancement)** (1.1k stars) — Most popular. You manually fill in structured tables (characters, events, items). Great UI, but nothing is automatic.
- **[MemoryBooks](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)** (167 stars) — Closest competitor for RP. 6-tier consolidation hierarchy (Arc through Epic). But you have to manually mark scene boundaries, and it requires strict JSON model output.
- **[MessageSummarize](https://github.com/qvink/SillyTavern-MessageSummarize)** (119 stars) — Summarizes each message individually. Good granularity, but no search — you just get the most recent summaries.
- **[ReMemory](https://github.com/InspectorCaracal/SillyTavern-ReMemory)** (46 stars) — Stores memories as lorebook entries with probabilistic recall (50% chance of firing). Creative concept but relevant memories may not trigger when needed.
- **[CharMemory](https://github.com/bal-spec/sillytavern-character-memory)** (36 stars) — Extracts facts about characters into Data Bank files, searched via vector embeddings. Character-focused, not narrative-focused.
- **[Timeline Memory](https://github.com/unkarelian/timeline-memory)** (31 stars) — Organizes memory into chapters the AI can query via tool calls. Requires tool-call-capable models.
- **[Qdrant Memory](https://github.com/HO-git/st-qdrant-memory)** (24 stars) — Vector search using a Qdrant database. Only extension with cross-chat memory. Requires Docker.
- **[InlineSummary](https://github.com/KrsityKu/InlineSummary)** (33 stars) — Manually select message ranges to compress into inline summaries. More of a context compression tool than a memory system.

### Detailed Comparison

| | **Anchor Memory** | **ST-Memory-Enhancement** | **MemoryBooks** | **Built-in Summarize** | **Built-in Vectors** |
|---|---|---|---|---|---|
| **How it works** | Episodes + scene tracking | Manual structured tables | Lorebook entries from scenes | Single rolling summary | Per-message embeddings |
| **Automatic?** | Fully automatic | No (you fill tables) | Semi (you mark scenes) | Yes | Yes |
| **Needs API?** | Optional (free tier works) | No | Yes (always) | Yes | Embedding model only |
| **Finds old memories** | Keyword + LLM scoring + archived search | Injects everything | Lorebook keyword matching | No (only latest summary) | Vector similarity |
| **Consolidation** | Multi-level pyramid (events, arcs, themes) | No | 6-tier hierarchy | Rolling (lossy) | No |
| **Old memories lost?** | No — archived and searchable | Manual management | No — lorebook persists | Yes — details compress away | No — all vectors kept |
| **RP-optimized** | Yes (scenes, threads, significance) | Partial | Yes (scenes, arcs) | No | No |
| **Group chat** | Not yet | Yes | Yes | Yes | Yes |

### Where Anchor Memory Fits

Anchor Memory is the only SillyTavern extension that combines fully automatic memory extraction, intelligent retrieval, hierarchical consolidation, and archived episode search — with a free tier that needs no API calls.

The closest competitor is **MemoryBooks**, which has a deeper consolidation hierarchy (6 tiers vs 4) but requires you to manually mark scene boundaries and only works with models that output strict JSON.

**What Anchor Memory doesn't do**: no vector/embedding search (uses keyword + LLM instead), no cross-chat memory (each chat is independent), and no group chat support yet.

## Limitations

- **Heuristic mode is rough** — regex-based scene extraction often captures narrative fragments as locations. The free tier works, but LLM mode is significantly better.
- **Fixed episode boundaries in heuristic mode** — scenes are committed every ~14 messages regardless of narrative pacing. LLM mode detects actual scene changes.
- **No group chat support** — currently designed for 1-on-1 roleplay.
- **100-episode active cap** — active episodes are capped at 100, with higher-depth summaries protected from eviction. Archived episodes are kept separately (up to 200) and remain searchable via the recall tool. In heuristic mode (no consolidation), oldest episodes are dropped.
- **No manual override** — you can't mark scenes or flag important messages. Memory extraction is fully automatic. Use `/am-scene` to force-commit if needed.
- **No embedding/vector retrieval** — retrieval uses keyword + significance scoring (and optional LLM), not semantic embeddings.
- **No cross-chat memory** — each chat has its own independent memory. The AI won't remember things from other conversations.

## Storage

All data stored in SillyTavern's chat metadata (`anchor_memory` key). No separate database, no Docker, no server. Deleting a chat deletes its memory.

- Scene card: ~1-2 KB (overwritten each turn)
- Per episode: ~1-2 KB
- Active episodes capped at 100 (higher-depth summaries prioritized)
- Archived episodes capped at 200 (searchable via recall tool)
- Typical 500-turn session: ~50-100 KB

## For Developers

### Architecture

```
anchor-memory/
  index.js              # Extension bootstrap, UI bindings
  core/
    settings.js         # Settings management + defaults
    storage.js          # Per-chat persistence in chat_metadata
  models/
    state-cards.js      # Scene card data model
    episodes.js         # Episode data model (includes keyFacts)
  writing/
    llm-extract-state.js   # LLM scene extraction + boundary detection
    extract-state.js       # Heuristic scene extraction (fallback)
    windowed-extractor.js  # Multi-pass windowed extraction (fallback)
    build-episode.js       # Heuristic episode creation (fallback)
    llm-summarizer.js      # Episode summaries (LLM structured + heuristic)
    consolidate-episodes.js  # Episode consolidation
  retrieval/
    query-builder.js    # Build query context from recent messages
    score-state.js      # Score scene card relevance
    score-episodes.js   # Keyword + significance + keyFacts scoring
    rlm-retriever.js    # LLM-powered retrieval (RLM)
    deep-retriever.js   # Deep retrieval with source message verification
    query-refiner.js    # Adaptive query refinement
    selector.js         # Final episode selection
    formatter.js        # Output formatting (text + XML, includes keyFacts)
  runtime/
    generation-hook.js  # Pre-generation memory injection
    postgen-hook.js     # Post-generation: extraction + boundary + episodes
    event-hooks.js      # SillyTavern event bindings
  integration/
    prompt-injection.js # Prompt payload construction
  commands/
    slash.js            # Slash commands with dialog output
  tools/
    memory-tool.js      # Optional recall_memory tool
  llm/
    api.js              # LLM API abstraction (ST service + quiet fallback)
  ui/
    panel.js            # Settings panel rendering
  eval/                 # Benchmarks and test suites
```

### Running Tests

```bash
# Syntax check all files
npm run check

# Deterministic eval suite (45 assertions)
npm run eval

# LLM extraction quality: LLM vs heuristic comparison
npm run eval:extraction

# RPBench: 4-config comparison on role-play-bench dataset
npm run eval:rpbench

# RP-Opus: 4-config comparison on rp-opus dataset
npm run eval:rp
```

### Contributing

1. Fork the repo
2. Make changes on a branch
3. Run `npm run check && npm run eval` to verify
4. Open a PR

Issues and feature requests: [GitHub Issues](https://github.com/kenny019/anchor-memory/issues)
