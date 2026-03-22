# Anchor Memory

**Install it. Forget about it. Your AI remembers everything.**

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

1. **Reads recent messages** to understand the current scene (location, who's present, what's happening)
2. **Scores past episodes** against the current context to find relevant memories
3. **Injects a memory block** into the prompt so the AI knows what happened before

The memory block looks like this (plain text mode):
```
[Anchor Memory]

[Current Scene State]
- Location: the forest clearing
- Time: night
- Goal: reach the citadel before dawn
- Conflict: riders approaching from the east
- Participants: User, Marcus
- Open Threads: who sent Elena | why did she betray us

[Relevant Past Events]
1. Betrayal in the tunnels [relationship, conflict]
Elena attacked with a hidden dagger in the underground tunnels. She mentioned "The Order" before fleeing.

2. Scene at The Rusty Anchor [location, goal]
Arrived at the tavern. Met Elena who told us about the missing map.
```

Or in XML mode (recommended for Claude and GPT models):
```xml
<anchor_memory>
<scene>
<location>the forest clearing</location>
<time>night</time>
<goal>reach the citadel before dawn</goal>
<conflict>riders approaching from the east</conflict>
<participants>User, Marcus</participants>
<open_threads>who sent Elena | why did she betray us</open_threads>
</scene>
<events>
<event significance="5" tags="relationship, conflict">
<title>Betrayal in the tunnels</title>
<summary>Elena attacked with a hidden dagger in the underground tunnels. She mentioned "The Order" before fleeing.</summary>
</event>
</events>
</anchor_memory>
```

## Features

### Free (no API calls)

Works out of the box with zero cost:

- Automatic scene state tracking (location, time, goals, conflicts, participants, threads)
- Windowed multi-pass extraction for better accuracy
- Keyword + significance-based episode retrieval
- Budget-aware injection that scales with conversation length
- Episode auto-creation every ~14 messages

### Enhanced (cheap LLM calls)

Point Anchor Memory at a cheap model (like `openai/gpt-5.4-nano` via OpenRouter) for smarter memory:

- **LLM Retrieval** — replaces keyword scoring with narrative-aware retrieval. Finds "the time she betrayed us" even if those exact words aren't in the episode.
- **LLM Summarization** — creates richer episode summaries that preserve character details, relationships, and causal connections.
- **Episode Consolidation** — merges old related episodes into compact semantic memories when your episode count grows.

Cost is negligible: roughly **$0.003 per 600-message chat** on `openai/gpt-5.4-nano`.

## Benchmark Results

Tested on a 600-message multi-character RP corpus with 15 narrative probes (questions like "What happened when Elena betrayed us?" or "Where did we first meet the merchant?").

| Configuration | Retrieval Accuracy | Accuracy on Reachable Probes |
|---|---|---|
| Heuristic + Keyword (free) | 53.3% | 54.5% |
| Heuristic + LLM Hybrid | 60.0% | 81.8% |
| LLM Episodes + Keyword | 46.7% | 63.6% |
| **LLM Episodes + Hybrid** | **66.7%** | **90.9%** |

The best configuration (LLM episodes + hybrid retrieval) achieves **90.9% accuracy on reachable probes**, a +36.4% improvement over keyword-only baseline. The free baseline still hits 54.5% with zero API cost.

## Comparison with Alternatives

| Feature | Anchor Memory | VectorMemory/TunnelVision | MemoryBooks | Built-in Summary |
|---|---|---|---|---|
| Setup effort | Install, done | Config + API keys + tuning | Manual authoring | None |
| API cost (free mode) | $0 | Embedding API calls | $0 | Summarization calls |
| Scene tracking | Automatic | None | Manual | None |
| Episode creation | Automatic | Chunk-based | Manual entries | Rolling summary |
| Retrieval method | Keyword + optional LLM | Vector similarity | Keyword triggers | None (appended) |
| Works offline | Yes (free mode) | No | Yes | No |

## Settings Guide

### Core Settings

| Setting | Default | What it does |
|---|---|---|
| **Enable** | On | Master toggle |
| **Preserve recent messages** | 12 | How many recent messages to analyze for context |
| **Max episodes** | 3 | Maximum episodes injected per generation |
| **Scene threshold** | 14 | Messages between automatic episode boundaries |
| **Prompt position** | In Chat | Where the memory block appears (In Chat / In Prompt / Before Prompt) |
| **Prompt depth** | 1 | How deep in the chat the injection sits |
| **Memory format** | Plain Text | Plain Text or XML (XML recommended for Claude/GPT) |

### Enhanced Memory (LLM)

| Setting | Default | What it does |
|---|---|---|
| **Model source** | (empty) | API provider (e.g. `openai`, `openrouter`) |
| **Model ID** | (empty) | Model to use (e.g. `openai/gpt-5.4-nano`) |
| **LLM Retrieval** | Off | Use LLM for narrative-aware memory retrieval |
| **LLM Summarization** | Off | Use LLM for richer episode summaries |

### Advanced (collapsed by default)

| Setting | Default | What it does |
|---|---|---|
| Windowed extraction | On | Multi-pass scene extraction for better accuracy |
| Window size | 8 | Messages per extraction window |
| Window overlap | 3 | Overlap between extraction windows |
| Chunk size | 10 | Episodes per LLM retrieval chunk |
| LLM Re-ranking | Off | Re-rank keyword results with LLM (legacy, use LLM Retrieval instead) |
| LLM Consolidation | Off | Merge old episodes into semantic memories |
| Auto-consolidation | On | Auto-consolidate when episode count exceeds threshold |
| Consolidation threshold | 60 | Episode count that triggers auto-consolidation |
| Memory tool | Off | Register a `recall_memory` tool the model can call on demand |

## Commands

These are optional — Anchor Memory works without them.

| Command | What it does |
|---|---|
| `/am-status` | Show current memory state (scene card, episode count) |
| `/am-retrieve` | Preview the memory block that would be injected |
| `/am-scene [title]` | Force-commit current scene into an episode |
| `/am-consolidate` | Manually consolidate old episodes into semantic memories |
| `/am-reset` | Clear all Anchor Memory data for the current chat |

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
    episodes.js         # Episode data model
  writing/
    extract-state.js    # Scene state extraction from messages
    windowed-extractor.js  # Multi-pass windowed extraction
    build-episode.js    # Episode candidate creation
    llm-summarizer.js   # LLM-powered episode summaries
    consolidate-episodes.js  # Episode consolidation
  retrieval/
    query-builder.js    # Build query context from recent messages
    score-state.js      # Score scene card relevance
    score-episodes.js   # Keyword + significance episode scoring
    rlm-retriever.js    # LLM-powered retrieval (RLM-inspired)
    deep-retriever.js   # Deep retrieval with source message verification
    query-refiner.js    # Adaptive query refinement
    reranker.js         # LLM re-ranking (legacy)
    selector.js         # Final episode selection with budget
    formatter.js        # Output formatting (text + XML)
  runtime/
    generation-hook.js  # Pre-generation memory injection
    postgen-hook.js     # Post-generation scene updates + episode creation
    event-hooks.js      # SillyTavern event bindings
  integration/
    prompt-injection.js # Prompt payload construction
  commands/
    slash.js            # Slash command registration
  tools/
    memory-tool.js      # Optional recall_memory tool
  llm/
    api.js              # LLM API abstraction
  ui/
    panel.js            # Settings panel rendering
  eval/                 # Test suite
```

### Running Tests

```bash
# Syntax check all files
npm run check

# Deterministic eval suite (45 assertions)
npm run eval

# LLM feature tests (requires OPENROUTER_API_KEY in .env)
npm run eval:llm

# Full RP benchmark — 4-config comparison (requires OPENROUTER_API_KEY)
npm run eval:rp
```

### Contributing

1. Fork the repo
2. Make changes on a branch
3. Run `npm run check && npm run eval` to verify
4. Open a PR

Issues and feature requests: [GitHub Issues](https://github.com/kenny019/anchor-memory/issues)
