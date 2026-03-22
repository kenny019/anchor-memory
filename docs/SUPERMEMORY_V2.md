# Supermemory V2 Integration

## Goal

Extend Anchor Memory without breaking its main product value:

- RP continuity should improve automatically
- prompt injection should stay small and stable
- the user should not need to babysit memory during roleplay

This means Supermemory should be treated as an optional remote backend for deeper recall, not as the core memory loop.

## Product Constraint: Immersion First

For roleplay, immersion is part of product quality.

If the user has to keep calling slash commands to preserve continuity, the extension is failing at its main job.

Manual commands are acceptable only as:

- overrides
- debugging tools
- recovery tools

They should not be part of the normal RP loop.

The default experience should be:

1. user chats normally
2. Anchor Memory updates scene state automatically
3. Anchor Memory commits episode summaries automatically at scene boundaries
4. Anchor Memory injects relevant memory automatically before generation

Supermemory must fit into that same automatic flow.

## Why Supermemory Is Not a V1 Dependency

Anchor Memory v1 is local and deterministic:

- current scene state is stored in `chat_metadata.anchor_memory`
- episodes are append-only and local to the active chat
- retrieval is inspectable and bounded

Supermemory adds useful capabilities, but it also changes the trust boundary:

- remote API dependency
- remote storage of RP content
- auth and secret management
- semantic retrieval that is less transparent than local deterministic scoring

Inference: because Anchor Memory runs as a browser-side SillyTavern extension, direct Supermemory integration would likely expose API credentials client-side unless a server-side bridge is added first.

So Supermemory should not replace the local scene and episode loop.

## Best Fit for Supermemory

Supermemory is a good fit for:

- older archived episode retrieval
- cross-chat recall
- canon and document retrieval
- semantic search over large memory histories

Supermemory is a bad fit for:

- per-turn scene state
- exact mutable continuity fields
- browser-side key handling
- requiring users to manually trigger sync or retrieval during RP

## Recommended Architecture

Use a hybrid model.

### Local fast path

Anchor Memory remains the source of truth for immediate continuity:

- `sceneCard` is local
- recent `episodes` are local
- pre-generation retrieval first checks local state

This path must work even if Supermemory is disabled or unavailable.

### Remote cold-memory path

Supermemory is used only for deeper recall:

- finalized episode summaries can be mirrored to Supermemory
- stable canon documents can be stored there
- pre-generation retrieval can query Supermemory only when local results are weak or insufficient

This keeps local behavior predictable while still extending recall depth.

## UX Rules

The user should not need to manually run commands to keep memory working.

### Automatic behavior

The extension should do these automatically:

- detect completed turns
- update local scene state
- detect scene boundaries
- create local episode summaries
- sync eligible episodes to Supermemory in the background
- query Supermemory only when useful

### Manual behavior

Commands remain available, but only as support tools:

- inspect current memory
- force a scene commit if heuristics miss it
- reset extension state
- debug sync state

Commands are not the primary workflow.

## Sync Model

Only summarized, structured memory should be sent remotely.

Do not send raw every-turn chat by default.

### What to sync

- episode title
- episode summary
- participants
- locations
- tags
- significance
- chat and scene identifiers

### What not to sync by default

- raw turn-by-turn transcript
- temporary scene state drafts
- browser-only diagnostic snapshots

### Remote identity

Use stable IDs:

- `customId = chatId:episodeId`
- `containerTag = anchor_memory:{scope}`

Suggested scopes:

- `anchor_memory:chat:{chatId}`
- `anchor_memory:persona:{personaId}`
- `anchor_memory:world:{worldId}`

This should be explicit and configurable.

## Retrieval Flow

Pre-generation retrieval should stay layered.

1. Read local `sceneCard`
2. Score local episodes
3. If local recall is sufficient, stop
4. If local recall is weak, query Supermemory
5. Merge only a small number of remote results
6. Format one stable prompt block

The prompt should still feel like Anchor Memory, not a raw remote dump.

Suggested sections:

- `[Current Scene State]`
- `[Relevant Past Events]`
- `[Deep Recall]`

`[Deep Recall]` should appear only when remote retrieval contributes something non-redundant.

## Trigger Policy

Supermemory should not be queried on every generation by default.

Prefer querying only when one of these is true:

- no local episode crosses a relevance threshold
- the current turn references an old thread not present in local episodes
- the chat has exceeded a local episode retention window
- the user has enabled cross-chat memory

This keeps latency and cost under control.

## Security Model

Do not store a Supermemory API key directly in the browser extension as the default architecture.

Recommended setup:

- Anchor Memory talks to a SillyTavern-side proxy or plugin
- the proxy owns the Supermemory key
- the browser receives only the results it needs

Minimum requirements:

- opt-in feature gate
- clear privacy disclosure
- per-chat or per-scope sync controls
- easy disable path

## Failure Handling

Remote memory must fail soft.

If Supermemory is unavailable:

- local memory still works
- generation still proceeds
- no user intervention is required
- sync jobs can retry later

If remote results are noisy:

- prefer local results
- cap injected remote items
- show remote contribution in the inspector

## Proposed V2 Scope

V2 should add:

- optional remote sync of finalized episodes
- optional remote retrieval for cold memory
- local-first retrieval fallback logic
- sync status in the inspector

V2 should not add yet:

- remote scene-state authority
- automatic lorebook mutation
- raw transcript upload by default
- mandatory cloud account for base functionality

## Success Criteria

Supermemory integration is successful only if all of these are true:

- RP flow remains mostly command-free
- local-only mode still feels complete
- remote mode improves old-memory recall measurably
- prompt size stays bounded
- failures degrade gracefully
- users understand what is stored remotely

## Recommendation

Build Supermemory support as an optional server-backed v2 module.

Do not make it a v1 dependency.
Do not use it as the source of truth for current scene state.
Do not require manual slash-command workflows for normal roleplay use.
