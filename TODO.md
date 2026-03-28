# Eval TODOs

## Priority 2: Golden set regression eval
Create 5-10 annotated scenarios in `eval/data/` with labeled expected retrievals. Extend `eval/run.js` Test 5 pattern to assert ranking accuracy (Precision@K, Recall@K). Requires manual annotation from real RP chats.

## Priority 3: LLM-as-judge + context utilization
After enough logged data from priority 1 (`/am-eval`), add automated quality scoring: judge relevance of retrieved episodes, check whether injected context influenced the LLM's output (token overlap or LLM judge).
