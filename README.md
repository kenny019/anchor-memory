# Anchor Memory

Anchor Memory is a [SillyTavern](https://github.com/SillyTavern/SillyTavern) extension for long-form roleplay memory. It tracks the current scene, stores episode memories, and injects relevant past context before generation.

Anchor Memory is now LLM-only. It stays inactive until you configure a dedicated memory model.

## Install

1. Open SillyTavern.
2. Go to **Extensions** > **Install Extension**.
3. Paste:

```text
https://github.com/kenny019/anchor-memory
```

4. Open the Anchor Memory settings panel.
5. Set both **Model source** and **Model ID**.

Until both are set, Anchor Memory loads but does not inject or update memory.

## How It Works

For each normal turn:

1. Anchor Memory reads recent chat context.
2. It updates the current scene using the configured memory model.
3. It decides whether the current scene should close into an episode.
4. It ranks stored episodes, verifies the strongest candidates, and injects a bounded memory block.

If a memory call fails, Anchor Memory fails closed for that turn: it injects nothing new and does not write degraded memory state.

## Features

- Scene continuity tracking: location, time, goals, conflicts, participants, open threads
- Character dossiers: per-character persistent state (relationship, traits, goals, known facts) extracted each turn
- Episode memory: structured summaries with significance, tags, and key facts
- Retrieval pipeline: deterministic prefilter plus LLM reranking on capped candidates
- Hierarchical consolidation: merge older episodes into higher-level semantic memories
- Archived recall: keep older memories searchable through the optional `recall_memory` tool

## Settings

### Core

- **Enable**: master toggle
- **Preserve recent messages**: how much recent chat to use as scene/retrieval context
- **Max episodes**: max episode memories to inject
- **Prompt position**: where the memory block is inserted
- **Prompt depth**: insertion depth
- **Memory format**: plain text or XML

### Memory Model

- **Model source**: provider/source used for memory calls
- **Model ID**: dedicated memory model identifier

### Advanced

- **Candidate count**: max episodes kept after deterministic prefilter
- **Chunk size**: batch size for LLM retrieval passes
- **Enable LLM consolidation**: turn semantic consolidation on/off
- **Auto-consolidate**: run consolidation automatically after threshold
- **Threshold**: active-episode count that triggers auto-consolidation
- **Max consolidation depth**: how many hierarchy levels to build
- **Min cluster size (fanout)**: minimum cluster size for consolidation
- **Archived search**: allow archived episodes in `recall_memory`
- **Archived score penalty**: down-rank archived hits
- **Max archived results**: cap archived recall results
- **Register recall_memory tool**: expose the optional tool-call interface

## Commands

- `/am-status`: show current memory status
- `/am-retrieve`: preview the current injected memory block
- `/am-scene [title]`: force-commit the current buffered scene as an episode
- `/am-consolidate`: run consolidation manually
- `/am-reset`: clear Anchor Memory data for the current chat

## Storage

Memory is stored in IndexedDB via `SillyTavern.libs.localforage`, keyed per chat.

- `am:{chatId}:state` — scene card, episodes, processing state
- `am:{chatId}:dossiers` — per-character dossiers
- Active episode cap: 100
- Archived episode cap: 200
- Character cap: 15 per chat

An in-memory cache keeps reads synchronous. Writes are debounced (300ms) with critical writes (episode creation) flushed immediately.

## Development

### Architecture

```text
anchor-memory/
  core/
    localforage-store.js
    dossier-store.js
    memory-config.js
    messages.js
    settings.js
    storage.js
  models/
    dossiers.js
    episodes.js
    state-cards.js
    string-utils.js
  runtime/
    generation-hook.js
    postgen-hook.js
    prepare-memory.js
  retrieval/
    query-builder.js
    score-episodes.js
    score-state.js
    llm-reranker.js
    deep-retriever.js
    query-refiner.js
    selector.js
    formatter.js
  writing/
    llm-extract-state.js
    llm-summarizer.js
    consolidate-episodes.js
  commands/
    slash.js
  tools/
    memory-tool.js
  llm/
    api.js
  ui/
    panel.js
  eval/
    run.js
    run-v2.js
```

### Verification

```bash
npm run check
npm run eval
```

## Notes

- Anchor Memory requires a working chat-completions style provider that supports the configured model.
- Memory stays inactive until a dedicated memory model is configured.
- The extension is designed for 1-on-1 RP chats, not group-chat memory management.
