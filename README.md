# Anchor Memory

**Install it. Forget about it. Your AI remembers what matters.**

Anchor Memory is a [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension that gives your AI persistent memory across long roleplay sessions. It tracks where you are, what's happening, and what happened before — then quietly injects the right context before every generation.

- **Tracks your scene** — location, time, goals, conflicts, participants, open plot threads
- **Remembers past events** — automatically creates episode summaries as your story progresses
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
| Consolidation | N/A | Merges old episodes into semantic memories |

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

## Commands

Optional — Anchor Memory works without them. Output appears in a dialog popup.

| Command | What it does |
|---|---|
| `/am-status` | Show current memory state (scene card, episode count, boundary) |
| `/am-retrieve` | Preview the memory block that would be injected |
| `/am-scene [title]` | Force-commit current scene into an episode |
| `/am-consolidate` | Manually consolidate old episodes into semantic memories |
| `/am-reset` | Clear all Anchor Memory data for the current chat |

You can also inspect state in the browser console:
```javascript
await window.AnchorMemory.getChatState()
```

## Comparison with Other Extensions

| | Anchor Memory | [ST-Memory-Enhancement](https://github.com/muyoou/st-memory-enhancement) | [MemoryBooks](https://github.com/aikohanasaki/SillyTavern-MemoryBooks) | [CharMemory](https://github.com/bal-spec/sillytavern-character-memory) | [Timeline Memory](https://github.com/unkarelian/timeline-memory) | Built-in Vectorization |
|---|---|---|---|---|---|---|
| **Auto-extract** | Yes (heuristic or LLM) | No (manual tables) | Semi (user marks scenes) | Yes (~20 msgs) | Yes (configurable) | Yes (auto-vectorize) |
| **Free tier** | Full heuristic mode | Yes (no API) | No | No | No | Free w/ local embeddings |
| **RP-optimized** | Yes (scenes, threads, episodes) | Partial (generic tables) | Yes (scenes, arcs) | No (character-focused) | Yes (chapters, arcs) | No (raw chunks) |
| **Retrieval** | Keyword + significance + optional RLM | Direct injection | Keyword or vector | Vector Storage (embeddings) | Agentic tool calls | Cosine similarity |
| **Group chat** | Not yet | Yes | Yes | Yes | Unknown | Yes |
| **Community** | New | ~1,100 stars | ~164 stars | ~35 stars | ~30 stars | Built-in |

**Where Anchor Memory fits**: Fully automatic, RP-native memory with zero mandatory API cost. Strongest retrieval pipeline of any ST memory extension. Trade-off: no embedding-based semantic search and no group chat support yet.

## Limitations

- **Heuristic mode is rough** — regex-based scene extraction often captures narrative fragments as locations. The free tier works, but LLM mode is significantly better.
- **Fixed episode boundaries in heuristic mode** — scenes are committed every ~14 messages regardless of narrative pacing. LLM mode detects actual scene changes.
- **No group chat support** — currently designed for 1-on-1 roleplay.
- **100-episode cap** — active episodes are capped at 100. In heuristic mode (no consolidation), old episodes are dropped. LLM mode merges them into semantic memories.
- **No manual override** — you can't mark scenes or flag important messages. Memory extraction is fully automatic. Use `/am-scene` to force-commit if needed.
- **No embedding/vector retrieval** — retrieval uses keyword + significance scoring (and optional LLM), not semantic embeddings.

## Storage

All data stored in SillyTavern's chat metadata (`anchor_memory` key). No separate database. Deleting a chat deletes its memory.

- Scene card: ~1-2 KB (overwritten each turn)
- Per episode: ~1-2 KB
- Active episodes capped at 100
- Typical 500-turn session: ~50-80 KB

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
