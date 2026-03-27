# Anchor Memory Build Plan

## Current Direction

Anchor Memory is an LLM-only SillyTavern extension focused on:

- one current-scene card
- append-only episode memory
- bounded retrieval and prompt injection
- semantic consolidation of older memories

## Runtime Priorities

- verify generation and postgen behavior in a real SillyTavern instance
- confirm prompt clearing on disabled, unconfigured, and failed memory turns
- confirm `lastProcessedTurnKey` still prevents duplicate writeback
- validate legacy chat-state compatibility after the shared message-ID normalization changes

## Product Priorities

- keep memory inactive until a dedicated model is configured
- keep slash commands as debug/override tools rather than required workflow
- keep retrieval bounded so memory quality improves continuity without flooding the prompt

## Verification Checklist

- `npm run check`
- `npm run eval`
- extension loads in SillyTavern without console errors
- prompt block injects only when memory is configured and retrieval succeeds
- repeated message events do not duplicate episodes
- `/am-retrieve` matches live injection behavior
- `/am-consolidate` and auto-consolidation both enforce the archived cap
