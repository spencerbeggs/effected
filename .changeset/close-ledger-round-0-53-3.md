---
"@effected/ai-plugins": patch
---

## Maintenance

* Closes the `effected-renovate` upgrade-ledger round released in 0.53.3, so the shipped ledger starts from that release. A repository older than the new baseline still gets every entry it crossed, fetched from the 0.53.3 release tag.
* The baseline floor rises to the versions the round brought consumers to, and now names `@effected/jsonl` and the Effect satellites `@effect/ai-anthropic`, `@effect/ai-openai`, `@effect/ai-openrouter` and `@effect/openapi-generator`
