---
"@effected/claude-code-plugin": minor
"@effected/copilot-plugin": minor
---

## Documentation

- The skills, agents and session-start briefing teach stable Effect v4. `partition` and its `separate` and `partitionMap` relatives are taught as returning `[successes, failures]`. `Schema.brand` is taught as one identifier per call and type-only, so `SchemaRepresentation` drops it. `TestSchema` is listed with `verifyRoundTrip` and its Effect forms.
- The source-lookup and module-index skills explain `@stability unstable` and `@stability experimental`, so an agent knows which APIs may change in a minor or patch release.
- Probes and the `@effect/vitest` install guidance compare against the lockfile's resolved `effect` and the vendored tag rather than the catalog literal, which is now a caret range. The briefing reports `effect@4.0.0` as the kit's pin.
