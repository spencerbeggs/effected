---
"@effected/ai-plugins": patch
---

## Documentation

* The `effected-renovate` upgrade ledger records what Effect 4.1.4 changed for a downstream project, in nine entries:
  * the reworked `--wizard` argv
  * `TestClock` letting a finalizer finish its first sleep
  * the regenerated `@effect/ai-openrouter` client
  * the structured-output codecs' dropped duplicate `null` branch
  * the OpenAI WebSocket and Anthropic finish-reason changes
  * the `toCodeDocument` and `fromJsonSchemaDocument` output changes
  * MCP Skills on older protocol revisions
  * two adoptions: `HttpApi.RedactedNames` and `WorkloadIdentity`
* `effect-v4-observability` names `HttpApi.RedactedNames` for names secret in one API, `effect-v4-schema` states which annotations `toCodeDocument` omits, and `effect-v4-module-index` lists `WorkloadIdentity`
* The session briefing names the vendored Effect source at 4.1.4

## Maintenance

* Closes the `effected-renovate` upgrade-ledger round released in 0.51.2, so the shipped ledger starts from that release. A repository older than the new baseline still gets every entry it crossed, fetched from the 0.51.2 release tag.
* The baseline floor rises to the versions the round brought consumers to, and now names `@effected/engine` and `@effected/shell`
