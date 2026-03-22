# Anchor Memory v1.1: Automatic By Default

## Goal

Make Anchor Memory usable for long RP sessions without requiring the user to interrupt immersion.

The product standard for v1.1 is:

- the user should be able to roleplay normally
- memory should update in the background
- retrieval should happen automatically
- slash commands should be optional support tools, not part of the normal workflow

## Why This Matters

For RP, memory quality is not just about recall accuracy.

It is also about preserving flow.

If the user has to keep typing commands like `/am-scene` to maintain continuity, the extension is still asking them to manage memory manually. That breaks immersion and weakens the product.

V1 already has the right architecture direction:

- local scene state
- append-only episodes
- deterministic retrieval

V1.1 should make that loop more automatic and more reliable.

## Product Principle

RP memory has to be automatic by default.

This means:

- auto-detect scene changes
- auto-commit episodes
- auto-update scene continuity
- auto-inject relevant memory

Manual controls still exist, but only for:

- overrides
- correction
- debugging
- recovery

## Target User Experience

Normal flow should look like this:

1. user opens chat
2. user roleplays normally for many turns
3. Anchor Memory keeps the current scene coherent
4. Anchor Memory automatically commits useful past events
5. older events are recalled when relevant
6. the user rarely needs a memory command

If frequent command use is still necessary, v1.1 has missed the goal.

## Core Changes

### 1. Automatic scene-boundary detection

`/am-scene` should stop being the main way episodes are created.

Instead, Anchor Memory should finalize a scene automatically when boundary confidence is high enough.

Boundary signals:

- strong location shift
- strong participant change
- explicit time jump
- message-count threshold
- topic break with thread carryover

`/am-scene` remains as a manual override.

## 2. Rolling scene candidate

Keep a background candidate for the current scene window.

Behavior:

- update candidate after each normal completed turn
- keep extending it while the scene is still ongoing
- finalize it when a boundary is detected
- force-finalize if the candidate grows too large

This reduces both missed scenes and low-value micro-episodes.

## 3. Confidence-based scene updates

The current extractor should stop acting like every detected value is equally trustworthy.

Each extracted field should carry confidence:

- `high`: safe to merge automatically
- `medium`: merge only if it strengthens or extends existing state
- `low`: do not overwrite current value

Examples:

- explicit location mention: high
- vague setting inference: low
- clear goal statement: high
- implicit emotional conflict guess: low

Low-confidence facts should either:

- stay out of the scene card
- or be recorded as open-thread hints rather than exact state

## 4. Hot and warm memory layers

V1.1 should make the memory model explicit:

- `hot memory`: current `sceneCard`
- `warm memory`: recent episodes

Retrieval policy:

- always consider `sceneCard`
- retrieve from recent episodes automatically
- inject nothing extra if relevance is weak

This keeps prompt assembly stable and prevents the extension from feeling noisy.

## 5. Passive correction UX

The user should not need commands for normal operation, but they still need a way to correct mistakes.

Prefer passive UI controls over chat commands.

Suggested panel actions:

- `Wrong location`
- `Split here`
- `Merge previous`
- `Ignore this episode`
- `Pin this thread`

These are repair tools, not the main workflow.

## 6. Reframe slash commands

Slash commands should be documented as support tools.

V1.1 role:

- `/am-status`: debugging
- `/am-retrieve`: debugging
- `/am-scene`: manual override
- `/am-reset`: recovery

None of these should be required for day-to-day RP use.

## Runtime Changes

### Post-generation loop

`runtime/postgen-hook.js` should evolve from threshold-only episode creation into a boundary-aware loop:

- process each completed normal turn
- update a rolling scene candidate
- merge high-confidence scene state
- score boundary confidence
- finalize an episode only when boundary confidence or size threshold is reached

### Scene extraction

`writing/extract-state.js` should return:

- extracted value
- confidence
- extraction reason

This makes scene-card merges safer and easier to inspect.

### Episode creation

`writing/build-episode.js` should consume the rolling candidate instead of just a fixed post-boundary range.

Episode output should prioritize:

- what changed
- who was involved
- what remains unresolved
- why the event matters later

### Retrieval

`runtime/generation-hook.js` should remain simple:

- load `sceneCard`
- score warm-memory episodes
- inject a bounded prompt block

No manual retrieval action should be necessary in the normal loop.

## Suggested Data Model Changes

V1.1 can stay small.

Add only what is needed:

- `pendingSceneCandidate`
- `lastBoundaryReason`
- optional per-field confidence in `sceneCard`

Do not add:

- full per-character auto-state yet
- canon memory yet
- vector retrieval yet

## Success Criteria

V1.1 is successful if:

- most chats do not require `/am-scene`
- scene cards drift less often
- episode quality improves without increasing prompt noise
- the extension remains usable when the user never touches memory commands

## Non-Goals

V1.1 is not the place to add:

- cloud memory dependencies
- lorebook mutation
- agentic tool loops
- heavy autonomous rewriting

The focus is operational reliability and immersion.

## Recommendation

Build v1.1 around one principle:

Make the automatic path good enough that commands feel optional.
