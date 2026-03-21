# Anchor Memory

Anchor Memory is a practical SillyTavern extension for RP continuity.

V1 is intentionally narrow:

- preserve recent raw chat
- keep one auto-managed scene state card
- store append-only episode summaries
- inject a small deterministic memory block before generation

It does not try to manage lorebooks, perform autonomous canon edits, or run vector retrieval.

## Current V1 Scope

Anchor Memory currently supports:

- SillyTavern third-party extension bootstrap
- per-chat persistence in `chat_metadata.anchor_memory`
- pre-generation retrieval through a `generate_interceptor`
- post-generation scene updates and episode creation
- deterministic prompt formatting
- slash commands for status, retrieval preview, forced scene commit, and reset
- a small inspector panel for the last retrieval snapshot

Out of scope for v1:

- lorebook writes
- canon integration
- vector reranking
- review queues
- rebuild-from-history workflows

## Persisted Model

Per chat, Anchor Memory stores:

- `version`
- `chatId`
- `lastProcessedTurnKey`
- `lastEpisodeBoundaryMessageId`
- `sceneCard`
- `episodes`

The `sceneCard` contains:

- `location`
- `timeContext`
- `activeGoal`
- `activeConflict`
- `openThreads`
- `participants`
- `updatedAtMessageId`
- `updatedAtTs`

Episodes are append-only summaries with spans, title, summary, participants, locations, tags, and significance.

## Prompt Shape

When memory is available, Anchor Memory injects:

```text
[Anchor Memory]

[Current Scene State]
- ...

[Relevant Past Events]
1. ...
```

If nothing relevant exists, it clears its prompt instead of injecting placeholder noise.

## Commands

- `/am-status`
- `/am-retrieve`
- `/am-scene [optional title]`
- `/am-reset`

## Layout

```text
anchor-memory/
  manifest.json
  index.js
  settings.html
  style.css
  package.json
  README.md
  docs/
  core/
  models/
  runtime/
  retrieval/
  writing/
  integration/
  ui/
  commands/
```
