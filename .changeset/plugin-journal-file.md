---
"@effected/ai-plugins": patch
---

## Documentation

* The `effected-packages` `@effected/jsonl` reference and construct index teach `JournalFile` from `@effected/jsonl/node`: read a journal file with no Effect runtime, resume from a saved `JournalCursor`, and detect a truncated, replaced or rewritten file, instead of hand-rolling `readSync` around `Line` and `Envelope`
