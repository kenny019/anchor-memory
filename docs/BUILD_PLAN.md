# Anchor Memory Build Plan

## V1 Goal

Ship a stable SillyTavern extension that improves RP continuity through:

- one persisted scene state card
- append-only episode memory
- deterministic retrieval and prompt injection

## Implemented Baseline

- extension bootstrap and settings panel
- `generate_interceptor` prompt hook
- chat metadata persistence
- slash-command registration
- heuristic scene extraction
- episode creation with span dedupe
- retrieval snapshot inspector

## Remaining Work

### 1. Runtime hardening

- dogfood the extension inside a real ST instance
- verify event behavior for `normal`, `quiet`, `swipe`, `continue`, and first-message flows
- confirm the `lastProcessedTurnKey` contract prevents duplicate writeback
- ensure prompt clearing behaves correctly across chat switches and disable/enable toggles

### 2. Heuristic quality

- improve scene extraction patterns for location, time, goals, conflicts, and open threads
- tune episode title and summary generation to be more useful without adding LLM dependency
- tune scoring weights for episode selection in realistic RP transcripts

### 3. UI polish

- make the settings panel clearer and less scaffold-like
- improve the inspector to show more readable scene and episode summaries
- optionally add a reset button in the UI to mirror `/am-reset`

### 4. Documentation and examples

- add usage examples for the slash commands
- document the persistence contract for `chat_metadata.anchor_memory`
- add notes on what v1 deliberately does not do

## Deferred Post-V1

- canon integration
- vector retrieval
- review queues
- per-character automatic state cards
- rebuild-from-history workflows

## Verification Checklist

- `npm run check`
- extension loads in ST without console errors
- prompt block injects only when memory exists
- repeated message events do not duplicate episodes
- `/am-scene` forces a single new episode
- `/am-reset` clears only Anchor Memory state for the active chat
