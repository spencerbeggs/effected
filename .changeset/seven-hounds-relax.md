---
"@effected/copilot-plugin": minor
---

## Features

### `bootstrapping-an-action` interview skill

Mirrors the Claude Code plugin's new user-invoked skill: an eight-question interview — identity, phases, GitHub access, inputs, outputs, runner capabilities, reporting, and self-dogfood — one question per message, that turns a fresh copy of the `github-action-template` repository into a planned action. It writes a plan file capturing the frozen I/O contract, the phase decision, the derived dependency list, the rename list, and a known-unknowns ledger, then hands off to the `action-engineer` agent to run `designing-an-action` from Phase 0. Only an explicit "bootstrap this template" request loads it.

`action-engineer` now preloads `bootstrapping-an-action` and owns publishing the output schema to schemastore as part of the output-contract workflow described below.

### Output contracts taught through schemastore

`actions-inputs-outputs` now teaches structured outputs as versioned, published JSON Schema documents. Any action with a JSON output runs a pre-write gate before emitting it, and a `SchemaPipeline.check` drift test keeps the published schema and the runtime `Schema` definition from diverging.

### `structuring-an-action` canon updates

- A new `schemas/` slot for committed JSON Schema documents: `schemas/<version>/<name>-<version>.json` for a versioned output contract, and an unversioned `<action>.input.schema.json` at the repo root for an input schema.
- Baseline-first emission: `program.ts` emits the all-disabled output baseline before any work, never from an `Effect.onError` handler, so a failure handler can never blank an output describing work that happened.
- A two-sided compile-time layers proof: type-level assertions that the app layer's requirement channel and the program's requirement channel, minus the runtime's `ActionServices`, are both `never`.
- The any-depth collection rule: the test runner's project discovery skips directories named `utils`, `fixtures` or `snapshots` at any depth, so `src/utils/` mirrors to `__test__/unit/utilities/`.
- The `@effected/memfs` mandate for any test that touches the filesystem, never a hand-rolled `FileSystem.layerNoop` double.

The `building-a-github-action` router and `testing-actions` skill are reconciled with this canon so their guidance and examples stay consistent with the new schema and testing rules.
